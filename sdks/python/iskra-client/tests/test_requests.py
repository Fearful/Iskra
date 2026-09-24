import pytest

from iskra_client import (
    AuthException,
    IskraClient,
    NotFoundException,
    ValidationException,
)


def test_success_envelope_is_unwrapped(iskra: IskraClient):
    resp = iskra.get("/contract/envelope")
    assert resp.success
    assert resp.data == {"items": [1, 2, 3]}
    assert resp.message == "listed"
    assert resp.status_code == 200


def test_plain_json_becomes_data(iskra: IskraClient):
    assert iskra.get("/contract/raw").data == [{"id": 1}, {"id": 2}]


def test_text_body_becomes_data(iskra: IskraClient):
    assert iskra.get("/contract/text").data == "pong"


def test_post_put_delete(iskra: IskraClient):
    assert iskra.post("/contract/echo", json={"a": 1}).data == {"a": 1}
    assert iskra.put("/contract/echo", json={"b": 2}).data == {"b": 2}
    resp = iskra.delete("/contract/echo")
    assert resp.success and resp.data is None and resp.status_code == 204


def test_query_params(iskra: IskraClient):
    assert iskra.get("/contract/envelope", params={"page": 2}).success


def test_api_key_and_custom_headers_are_sent(base_url: str):
    with IskraClient(base_url=base_url, api_key="sk-test", headers={"X-Custom": "yes"}) as client:
        assert client.get("/contract/headers").data == {"apiKey": "sk-test", "custom": "yes"}


def test_error_handler_errors_are_typed(iskra: IskraClient):
    with pytest.raises(NotFoundException) as err:
        iskra.get("/contract/not-found")
    assert str(err.value) == "Widget not found"
    assert err.value.status_code == 404
    assert err.value.error_code == "NOT_FOUND"


def test_validation_details_are_exposed(iskra: IskraClient):
    with pytest.raises(ValidationException) as err:
        iskra.post("/contract/validate")
    assert err.value.error_code == "VALIDATION_ERROR"
    assert err.value.details == {"field": "name", "issue": "required"}


def test_unauthenticated_route(iskra: IskraClient):
    with pytest.raises(AuthException) as err:
        iskra.get("/contract/me")
    assert err.value.status_code == 401


def test_plain_text_error_body(iskra: IskraClient):
    with pytest.raises(NotFoundException) as err:
        iskra.get("/contract/does-not-exist")
    assert "Not Found" in str(err.value)


async def test_async_requests(iskra: IskraClient):
    assert (await iskra.async_get("/contract/envelope")).data == {"items": [1, 2, 3]}
    assert (await iskra.async_post("/contract/echo", json={"x": True})).data == {"x": True}
    with pytest.raises(NotFoundException):
        await iskra.async_get("/contract/not-found")


def test_async_calls_work_across_event_loops(iskra: IskraClient):
    import asyncio

    # e.g. Django's async_to_sync runs each call in a fresh event loop.
    for _ in range(2):
        assert asyncio.run(iskra.async_get("/contract/envelope")).success
