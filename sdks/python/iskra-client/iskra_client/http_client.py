from __future__ import annotations
from pathlib import Path
from typing import Any, Dict, Optional, Type, TypeVar

import httpx

from iskra_client.config import IskraConfig
from iskra_client.exceptions import IskraException
from iskra_client.responses import IskraResponse

T = TypeVar("T")


class HttpClientWrapper:
    def __init__(self, config: IskraConfig) -> None:
        self._config = config
        headers: Dict[str, str] = {**config.headers}
        if config.api_key:
            headers["X-API-Key"] = config.api_key

        self._client = httpx.Client(
            base_url=config.base_url.rstrip("/"),
            headers=headers,
            timeout=config.timeout,
        )
        self._async_client: Optional[httpx.AsyncClient] = None

    # ── Sync methods ─────────────────────────────────────────────────────

    def get(self, path: str) -> IskraResponse:
        resp = self._client.get(path)
        return self._handle(resp)

    def post(self, path: str, json: Any = None) -> IskraResponse:
        resp = self._client.post(path, json=json)
        return self._handle(resp)

    def put(self, path: str, json: Any = None) -> IskraResponse:
        resp = self._client.put(path, json=json)
        return self._handle(resp)

    def delete(self, path: str) -> IskraResponse:
        resp = self._client.delete(path)
        return self._handle(resp)

    def get_bytes(self, path: str) -> bytes:
        resp = self._client.get(path)
        if resp.status_code >= 400:
            self._handle_error(resp)
        return resp.content

    def upload_file(self, path: str, file_path: Path, file_name: str) -> IskraResponse:
        with open(file_path, "rb") as f:
            files = {"file": (file_name, f, "application/octet-stream")}
            resp = self._client.post(path, files=files)
        return self._handle(resp)

    # ── Async methods ────────────────────────────────────────────────────

    def _get_async_client(self) -> httpx.AsyncClient:
        if self._async_client is None or self._async_client.is_closed:
            headers: Dict[str, str] = {**self._config.headers}
            if self._config.api_key:
                headers["X-API-Key"] = self._config.api_key
            self._async_client = httpx.AsyncClient(
                base_url=self._config.base_url.rstrip("/"),
                headers=headers,
                timeout=self._config.timeout,
            )
        return self._async_client

    async def async_get(self, path: str) -> IskraResponse:
        resp = await self._get_async_client().get(path)
        return self._handle(resp)

    async def async_post(self, path: str, json: Any = None) -> IskraResponse:
        resp = await self._get_async_client().post(path, json=json)
        return self._handle(resp)

    async def async_put(self, path: str, json: Any = None) -> IskraResponse:
        resp = await self._get_async_client().put(path, json=json)
        return self._handle(resp)

    async def async_delete(self, path: str) -> IskraResponse:
        resp = await self._get_async_client().delete(path)
        return self._handle(resp)

    async def async_get_bytes(self, path: str) -> bytes:
        resp = await self._get_async_client().get(path)
        if resp.status_code >= 400:
            self._handle_error(resp)
        return resp.content

    async def async_upload_file(self, path: str, file_path: Path, file_name: str) -> IskraResponse:
        with open(file_path, "rb") as f:
            files = {"file": (file_name, f, "application/octet-stream")}
            resp = await self._get_async_client().post(path, files=files)
        return self._handle(resp)

    # ── Response handling ────────────────────────────────────────────────

    def _handle(self, resp: httpx.Response) -> IskraResponse:
        if resp.status_code >= 400:
            self._handle_error(resp)

        if not resp.content:
            return IskraResponse(success=True)

        body = resp.json()

        if isinstance(body, dict) and "success" in body:
            return IskraResponse.from_dict(body)

        return IskraResponse(success=True, data=body)

    def _handle_error(self, resp: httpx.Response) -> None:
        try:
            body = resp.json()
            raise IskraException.from_error_response(resp.status_code, body)
        except IskraException:
            raise
        except Exception:
            raise IskraException(
                message=f"HTTP {resp.status_code}: {resp.text}",
                status_code=resp.status_code,
            )

    # ── Cleanup ──────────────────────────────────────────────────────────

    def close(self) -> None:
        self._client.close()
        if self._async_client and not self._async_client.is_closed:
            # For sync cleanup of async client, best-effort
            pass

    async def aclose(self) -> None:
        self._client.close()
        if self._async_client and not self._async_client.is_closed:
            await self._async_client.aclose()
