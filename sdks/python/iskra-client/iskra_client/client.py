from __future__ import annotations
from typing import Any, Optional

from iskra_client.auth.client import AuthClient
from iskra_client.config import IskraConfig
from iskra_client.health.client import HealthClient
from iskra_client.http_client import HttpClientWrapper
from iskra_client.responses import IskraResponse
from iskra_client.storage.client import StorageClient


class IskraClient:
    def __init__(
        self,
        base_url: str,
        api_key: Optional[str] = None,
        timeout: float = 30.0,
        headers: Optional[dict] = None,
        auth_base_path: str = "/api/sso",
    ) -> None:
        self._config = IskraConfig(
            base_url=base_url,
            api_key=api_key,
            timeout=timeout,
            headers=headers or {},
            auth_base_path=auth_base_path,
        )
        self._http = HttpClientWrapper(self._config)
        self._auth = AuthClient(self._http, self._config.auth_base_path)
        self._health = HealthClient(self._http)
        self._storage = StorageClient(self._http)

    # ── Sub-clients ──────────────────────────────────────────────────────

    @property
    def auth(self) -> AuthClient:
        return self._auth

    @property
    def health(self) -> HealthClient:
        return self._health

    @property
    def storage(self) -> StorageClient:
        return self._storage

    @property
    def config(self) -> IskraConfig:
        return self._config

    # ── Generic sync methods ─────────────────────────────────────────────

    def get(self, path: str) -> IskraResponse:
        return self._http.get(path)

    def post(self, path: str, json: Any = None) -> IskraResponse:
        return self._http.post(path, json=json)

    def put(self, path: str, json: Any = None) -> IskraResponse:
        return self._http.put(path, json=json)

    def delete(self, path: str) -> IskraResponse:
        return self._http.delete(path)

    # ── Generic async methods ────────────────────────────────────────────

    async def async_get(self, path: str) -> IskraResponse:
        return await self._http.async_get(path)

    async def async_post(self, path: str, json: Any = None) -> IskraResponse:
        return await self._http.async_post(path, json=json)

    async def async_put(self, path: str, json: Any = None) -> IskraResponse:
        return await self._http.async_put(path, json=json)

    async def async_delete(self, path: str) -> IskraResponse:
        return await self._http.async_delete(path)

    # ── Lifecycle ────────────────────────────────────────────────────────

    def close(self) -> None:
        self._http.close()

    async def aclose(self) -> None:
        await self._http.aclose()

    def __enter__(self) -> IskraClient:
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()

    async def __aenter__(self) -> IskraClient:
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.aclose()
