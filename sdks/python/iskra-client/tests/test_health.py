import pytest

from iskra_client import IskraClient


@pytest.fixture
def unhealthy(iskra: IskraClient):
    iskra.post("/contract/health", json={"healthy": False})
    yield
    iskra.post("/contract/health", json={"healthy": True})


def test_check_returns_the_body(iskra: IskraClient):
    health = iskra.health.check()
    assert health["status"] == "ok"
    assert "timestamp" in health
    assert iskra.health.is_healthy()


def test_check_returns_the_error_body_on_503(iskra: IskraClient, unhealthy):
    assert iskra.health.check()["status"] == "error"
    assert not iskra.health.is_healthy()


def test_ready_and_live(iskra: IskraClient):
    assert iskra.health.ready()["status"] == "ready"
    assert iskra.health.live()["status"] == "alive"


async def test_async_variants(iskra: IskraClient):
    assert (await iskra.health.async_check())["status"] == "ok"
    assert (await iskra.health.async_live())["status"] == "alive"
    assert await iskra.health.async_is_healthy()
