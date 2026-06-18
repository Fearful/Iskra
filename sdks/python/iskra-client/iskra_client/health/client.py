from __future__ import annotations
from typing import Any, Dict, TYPE_CHECKING

if TYPE_CHECKING:
    from iskra_client.http_client import HttpClientWrapper


class HealthClient:
    def __init__(self, http: HttpClientWrapper) -> None:
        self._http = http

    # ── Sync ─────────────────────────────────────────────────────────────

    def check(self) -> Dict[str, Any]:
        resp = self._http.get("/health")
        return resp.data if resp.data else {}

    def ready(self) -> Dict[str, Any]:
        resp = self._http.get("/health/ready")
        return resp.data if resp.data else {}

    def live(self) -> Dict[str, Any]:
        resp = self._http.get("/health/live")
        return resp.data if resp.data else {}

    # ── Async ────────────────────────────────────────────────────────────

    async def async_check(self) -> Dict[str, Any]:
        resp = await self._http.async_get("/health")
        return resp.data if resp.data else {}

    async def async_ready(self) -> Dict[str, Any]:
        resp = await self._http.async_get("/health/ready")
        return resp.data if resp.data else {}

    async def async_live(self) -> Dict[str, Any]:
        resp = await self._http.async_get("/health/live")
        return resp.data if resp.data else {}
