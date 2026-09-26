import pytest

from iskra_client import (
    AuthException,
    ConflictException,
    ForbiddenException,
    IskraClient,
    NotFoundException,
    RateLimitException,
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


def test_query_params_are_encoded(iskra: IskraClient):
    params = {"q": "a b&c=d/ñ+", "tags": ["x", "y"], "skip": None, "flag": True, "n": 2}
    assert iskra.get("/contract/query", params=params).data == {
        "q": ["a b&c=d/ñ+"],
        "tags": ["x", "y"],
        "flag": ["true"],
        "n": ["2"],
    }
    assert iskra.get("/contract/query?page=1", params={"size": 10}).data == {"page": ["1"], "size": ["10"]}


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


def test_forbidden_conflict_and_rate_limit_are_typed(iskra: IskraClient):
    with pytest.raises(ForbiddenException) as forbidden:
        iskra.get("/contract/forbidden")
    assert str(forbidden.value) == "Not your widget"
    assert forbidden.value.status_code == 403
    assert forbidden.value.error_code == "FORBIDDEN"

    with pytest.raises(ConflictException) as conflict:
        iskra.post("/contract/conflict")
    assert str(conflict.value) == "Widget already exists"
    assert conflict.value.status_code == 409
    assert conflict.value.error_code == "CONFLICT"

    with pytest.raises(RateLimitException) as limited:
        iskra.get("/contract/rate-limited")
    assert str(limited.value) == "Too many requests"
    assert limited.value.status_code == 429


def test_rate_limit_exposes_retry_after(iskra: IskraClient):
    from email.utils import format_datetime
    from datetime import datetime, timedelta, timezone

    with pytest.raises(RateLimitException) as seconds:
        iskra.get("/contract/rate-limited")
    assert seconds.value.retry_after == 7.0

    when = format_datetime(datetime.now(timezone.utc) + timedelta(seconds=120), usegmt=True)
    with pytest.raises(RateLimitException) as date:
        iskra.get("/contract/rate-limited", params={"retryAfter": when})
    assert date.value.retry_after is not None and 100 < date.value.retry_after <= 120

    past = format_datetime(datetime.now(timezone.utc) - timedelta(seconds=60), usegmt=True)
    for value, expected in (("", None), ("soon", None), ("-5", None), (past, 0.0)):
        with pytest.raises(RateLimitException) as other:
            iskra.get("/contract/rate-limited", params={"retryAfter": value})
        assert other.value.retry_after == expected, value


async def test_async_rate_limit_exposes_retry_after(iskra: IskraClient):
    with pytest.raises(RateLimitException) as err:
        await iskra.async_get("/contract/rate-limited")
    assert err.value.retry_after == 7.0


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


def test_connection_errors_are_iskra_exceptions():
    import socket

    from iskra_client import IskraException

    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    client = IskraClient(f"http://127.0.0.1:{port}")
    # An httpx.ConnectError escaped, so handlers for IskraException (such as
    # the FastAPI example's) answered 500.
    with pytest.raises(IskraException) as info:
        client.get("/anything")
    assert info.value.status_code == 0


def test_absolute_urls_are_refused_before_any_credential_leaves(base_url: str):
    import http.server
    import threading

    seen: list = []

    class Attacker(http.server.BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802 - http.server's naming
            seen.append(dict(self.headers))
            self.send_response(200)
            self.end_headers()

        def log_message(self, *args):
            pass

    server = http.server.HTTPServer(("127.0.0.1", 0), Attacker)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with IskraClient(base_url=base_url, api_key="sk-live-SECRET") as client:
            as_user = client.with_session("better-auth.session_token=VICTIM.sig")
            for path in (f"http://127.0.0.1:{server.server_port}/steal", f"//127.0.0.1:{server.server_port}/steal"):
                with pytest.raises(ValueError):
                    as_user.get(path)
        assert seen == []
    finally:
        server.shutdown()


def test_secrets_stay_out_of_repr():
    from iskra_client import IskraConfig
    from iskra_client.auth.models import Session, SessionInfo

    config = IskraConfig(base_url="http://iskra", api_key="sk-live-SECRET", headers={"Authorization": "Bearer X"})
    session = Session(session=SessionInfo(id="s1", token="TOKEN-abc"), cookie="better-auth.session_token=TOKEN-abc.sig")
    text = repr(config) + repr(session)
    for secret in ("sk-live-SECRET", "Bearer X", "TOKEN-abc"):
        assert secret not in text
    assert "http://iskra" in text and "s1" in text
