from __future__ import annotations
import asyncio
import http.cookiejar
import weakref
from typing import Any, Collection, Dict, Mapping, Optional
from urllib.parse import urlsplit

import httpx

from iskra_client.config import IskraConfig
from iskra_client.exceptions import IskraException
from iskra_client.responses import IskraResponse


def _cookieless_jar() -> http.cookiejar.CookieJar:
    # An IskraClient is typically shared by every request of a backend. If it
    # stored the Set-Cookie of a sign-in, the next caller would act as that
    # user, so it stores none: sessions are bound explicitly with
    # IskraClient.with_session().
    return http.cookiejar.CookieJar(http.cookiejar.DefaultCookiePolicy(allowed_domains=[]))


def _origin_of(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}"


class _Transport:
    """The httpx clients shared by an IskraClient and its session-bound views."""

    def __init__(self, config: IskraConfig) -> None:
        headers: Dict[str, str] = {**config.headers}
        if config.api_key:
            headers["X-API-Key"] = config.api_key
        self._options: Dict[str, Any] = {
            "base_url": config.base_url.rstrip("/"),
            "headers": headers,
            "timeout": config.timeout,
        }
        self.sync = httpx.Client(cookies=_cookieless_jar(), **self._options)
        # One AsyncClient per event loop: its pooled connections belong to the
        # loop that opened them, and frameworks such as Django's async_to_sync
        # (or test clients) run each call in a new loop.
        self._async: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, httpx.AsyncClient]" = (
            weakref.WeakKeyDictionary()
        )

    @property
    def async_client(self) -> httpx.AsyncClient:
        loop = asyncio.get_running_loop()
        client = self._async.get(loop)
        if client is None or client.is_closed:
            client = httpx.AsyncClient(cookies=_cookieless_jar(), **self._options)
            self._async[loop] = client
        return client

    def close(self) -> None:
        self.sync.close()

    async def aclose(self) -> None:
        self.sync.close()
        client = self._async.pop(asyncio.get_running_loop(), None)
        if client is not None and not client.is_closed:
            await client.aclose()


class HttpClientWrapper:
    def __init__(
        self,
        config: IskraConfig,
        transport: Optional[_Transport] = None,
        extra_headers: Optional[Mapping[str, str]] = None,
    ) -> None:
        self._config = config
        self._transport = transport or _Transport(config)
        self._extra_headers: Dict[str, str] = dict(extra_headers or {})

    @property
    def config(self) -> IskraConfig:
        return self._config

    @property
    def cookie(self) -> Optional[str]:
        """The session cookie this wrapper is bound to, if any."""
        return self._extra_headers.get("Cookie")

    def bind_cookie(self, cookie: str) -> HttpClientWrapper:
        """A wrapper sharing this one's connections that authenticates as the
        session in `cookie` (a Cookie header value)."""
        headers = {
            **self._extra_headers,
            "Cookie": cookie,
            "Origin": self._config.origin or _origin_of(self._config.base_url),
        }
        return HttpClientWrapper(self._config, self._transport, headers)

    # ── Sync methods ─────────────────────────────────────────────────────

    def request(
        self,
        method: str,
        path: str,
        *,
        json: Any = None,
        params: Optional[Mapping[str, Any]] = None,
        files: Any = None,
        ok_statuses: Collection[int] = (),
    ) -> httpx.Response:
        """Sends a request and returns the raw response, raising the matching
        IskraException for a 4xx/5xx status not listed in `ok_statuses`."""
        try:
            resp = self._transport.sync.request(
                method, path, json=json, params=_clean(params), files=files, headers=self._extra_headers
            )
        except httpx.HTTPError as e:
            raise _transport_error(e) from e
        return self._check(resp, ok_statuses)

    def get(self, path: str, params: Optional[Mapping[str, Any]] = None) -> IskraResponse:
        return self._handle(self.request("GET", path, params=params))

    def post(self, path: str, json: Any = None) -> IskraResponse:
        return self._handle(self.request("POST", path, json=json))

    def put(self, path: str, json: Any = None) -> IskraResponse:
        return self._handle(self.request("PUT", path, json=json))

    def delete(self, path: str) -> IskraResponse:
        return self._handle(self.request("DELETE", path))

    def get_bytes(self, path: str) -> bytes:
        return self.request("GET", path).content

    # ── Async methods ────────────────────────────────────────────────────

    async def async_request(
        self,
        method: str,
        path: str,
        *,
        json: Any = None,
        params: Optional[Mapping[str, Any]] = None,
        files: Any = None,
        ok_statuses: Collection[int] = (),
    ) -> httpx.Response:
        try:
            resp = await self._transport.async_client.request(
                method, path, json=json, params=_clean(params), files=files, headers=self._extra_headers
            )
        except httpx.HTTPError as e:
            raise _transport_error(e) from e
        return self._check(resp, ok_statuses)

    async def async_get(self, path: str, params: Optional[Mapping[str, Any]] = None) -> IskraResponse:
        return self._handle(await self.async_request("GET", path, params=params))

    async def async_post(self, path: str, json: Any = None) -> IskraResponse:
        return self._handle(await self.async_request("POST", path, json=json))

    async def async_put(self, path: str, json: Any = None) -> IskraResponse:
        return self._handle(await self.async_request("PUT", path, json=json))

    async def async_delete(self, path: str) -> IskraResponse:
        return self._handle(await self.async_request("DELETE", path))

    async def async_get_bytes(self, path: str) -> bytes:
        return (await self.async_request("GET", path)).content

    # ── Response handling ────────────────────────────────────────────────

    @staticmethod
    def _check(resp: httpx.Response, ok_statuses: Collection[int]) -> httpx.Response:
        if resp.status_code >= 400 and resp.status_code not in ok_statuses:
            raise IskraException.from_error_response(resp.status_code, parse_body(resp))
        return resp

    @staticmethod
    def _handle(resp: httpx.Response) -> IskraResponse:
        body = parse_body(resp)
        if isinstance(body, dict) and "success" in body:
            return IskraResponse.from_dict(body, status_code=resp.status_code)
        return IskraResponse(success=True, data=body, status_code=resp.status_code)

    # ── Cleanup ──────────────────────────────────────────────────────────

    def close(self) -> None:
        self._transport.close()

    async def aclose(self) -> None:
        await self._transport.aclose()


def parse_body(resp: httpx.Response) -> Any:
    """JSON when the response is JSON, its text otherwise, None when empty."""
    if not resp.content:
        return None
    if "json" in resp.headers.get("content-type", ""):
        try:
            return resp.json()
        except ValueError:
            pass
    return resp.text


def _transport_error(error: httpx.HTTPError) -> IskraException:
    """A connection failure or timeout as an IskraException (status 0), so
    callers that handle IskraException do not crash with an httpx error."""
    kind = "timed out" if isinstance(error, httpx.TimeoutException) else "failed"
    return IskraException(f"HTTP request {kind}: {error}", status_code=0)


def _clean(params: Optional[Mapping[str, Any]]) -> Optional[Dict[str, Any]]:
    if params is None:
        return None
    return {k: v for k, v in params.items() if v is not None}
