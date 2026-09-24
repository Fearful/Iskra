from __future__ import annotations
from typing import Any, Dict, TYPE_CHECKING

from iskra_client.http_client import parse_body

if TYPE_CHECKING:
    from iskra_client.http_client import HttpClientWrapper

# /health and /health/ready answer 503 with the same body shape when a check
# fails ({"status": "error", ...}); that is a result to return, not an error.
_UNHEALTHY = (503,)


class HealthClient:
    def __init__(self, http: HttpClientWrapper) -> None:
        self._http = http

    # ── Sync ─────────────────────────────────────────────────────────────

    def check(self) -> Dict[str, Any]:
        return self._get("/health")

    def ready(self) -> Dict[str, Any]:
        return self._get("/health/ready")

    def live(self) -> Dict[str, Any]:
        return self._get("/health/live")

    def is_healthy(self) -> bool:
        return self.check().get("status") == "ok"

    # ── Async ────────────────────────────────────────────────────────────

    async def async_check(self) -> Dict[str, Any]:
        return await self._async_get("/health")

    async def async_ready(self) -> Dict[str, Any]:
        return await self._async_get("/health/ready")

    async def async_live(self) -> Dict[str, Any]:
        return await self._async_get("/health/live")

    async def async_is_healthy(self) -> bool:
        return (await self.async_check()).get("status") == "ok"

    # ── Helpers ──────────────────────────────────────────────────────────

    def _get(self, path: str) -> Dict[str, Any]:
        return _as_dict(parse_body(self._http.request("GET", path, ok_statuses=_UNHEALTHY)))

    async def _async_get(self, path: str) -> Dict[str, Any]:
        return _as_dict(parse_body(await self._http.async_request("GET", path, ok_statuses=_UNHEALTHY)))


def _as_dict(body: Any) -> Dict[str, Any]:
    return body if isinstance(body, dict) else {}
