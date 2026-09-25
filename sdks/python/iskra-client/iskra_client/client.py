from __future__ import annotations
from typing import Any, Mapping, Optional

from iskra_client.auth.client import AuthClient, SessionLike, session_cookie
from iskra_client.config import DEFAULT_MAX_RESPONSE_BYTES, IskraConfig
from iskra_client.health.client import HealthClient
from iskra_client.http_client import HttpClientWrapper
from iskra_client.responses import IskraResponse
from iskra_client.storage.client import StorageClient


class IskraClient:
    def __init__(
        self,
        base_url: str,
        api_key: Optional[str] = None,
        timeout: Optional[float] = 30.0,
        headers: Optional[dict] = None,
        auth_base_path: str = "/api/sso",
        origin: Optional[str] = None,
        storage_route_prefix: str = "/upload",
        max_response_bytes: int = DEFAULT_MAX_RESPONSE_BYTES,
    ) -> None:
        """`timeout` bounds each whole request, in seconds; `max_response_bytes`
        the size of each response body (see IskraConfig)."""
        config = IskraConfig(
            base_url=base_url,
            api_key=api_key,
            timeout=timeout,
            headers=headers or {},
            auth_base_path=auth_base_path,
            origin=origin,
            storage_route_prefix=storage_route_prefix,
            max_response_bytes=max_response_bytes,
        )
        self._init(HttpClientWrapper(config), owns_transport=True)

    def _init(self, http: HttpClientWrapper, owns_transport: bool) -> None:
        self._config = http.config
        self._http = http
        self._owns_transport = owns_transport
        self._auth = AuthClient(http, self._config.auth_base_path)
        self._health = HealthClient(http)
        self._storage = StorageClient(http, self._config.storage_route_prefix)

    def with_session(self, session: SessionLike) -> IskraClient:
        """A client that makes every request as the user of `session` (a
        Session from sign_in/sign_up, or its `cookie` string).

        It shares this client's connections; closing it is a no-op, close the
        client it came from. The client itself never stores cookies, so one
        instance can safely serve every user of a backend.
        """
        view = IskraClient.__new__(IskraClient)
        view._init(self._http.bind_cookie(session_cookie(session)), owns_transport=False)
        return view

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

    def get(self, path: str, params: Optional[Mapping[str, Any]] = None) -> IskraResponse:
        return self._http.get(path, params=params)

    def post(self, path: str, json: Any = None) -> IskraResponse:
        return self._http.post(path, json=json)

    def put(self, path: str, json: Any = None) -> IskraResponse:
        return self._http.put(path, json=json)

    def delete(self, path: str) -> IskraResponse:
        return self._http.delete(path)

    # ── Generic async methods ────────────────────────────────────────────

    async def async_get(self, path: str, params: Optional[Mapping[str, Any]] = None) -> IskraResponse:
        return await self._http.async_get(path, params=params)

    async def async_post(self, path: str, json: Any = None) -> IskraResponse:
        return await self._http.async_post(path, json=json)

    async def async_put(self, path: str, json: Any = None) -> IskraResponse:
        return await self._http.async_put(path, json=json)

    async def async_delete(self, path: str) -> IskraResponse:
        return await self._http.async_delete(path)

    # ── Lifecycle ────────────────────────────────────────────────────────

    def close(self) -> None:
        if self._owns_transport:
            self._http.close()

    async def aclose(self) -> None:
        if self._owns_transport:
            await self._http.aclose()

    def __enter__(self) -> IskraClient:
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()

    async def __aenter__(self) -> IskraClient:
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.aclose()
