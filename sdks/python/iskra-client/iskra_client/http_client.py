from __future__ import annotations
import asyncio
import contextvars
import http.cookiejar
import threading
import weakref
from typing import Any, Callable, Collection, Dict, Mapping, Optional, TypeVar
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


def _check_path(path: str) -> None:
    """A path on the Iskra service, never a URL of its own: httpx sends an
    absolute URL as is, ignoring base_url, so `get("https://other.host/x")`
    sent the API key and the user's session cookie to that host."""
    parts = urlsplit(path)
    if parts.scheme or parts.netloc:
        raise ValueError(f"Request path must be a path on the Iskra service, not a URL: {path!r}")


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
        IskraException for a 4xx/5xx status not listed in `ok_statuses`.

        The whole request (connecting, sending, the headers and the body) must
        finish within `config.timeout` seconds, and the body may not exceed
        `config.max_response_bytes`."""
        _check_path(path)
        limit = self._config.max_response_bytes

        def send(cancelled: threading.Event) -> httpx.Response:
            try:
                with self._transport.sync.stream(
                    method, path, json=json, params=_clean(params), files=files, headers=self._extra_headers
                ) as resp:
                    _check_declared_size(resp, limit)
                    body = bytearray()
                    for chunk in resp.iter_bytes():
                        if cancelled.is_set():
                            break  # the caller already got its timeout
                        body += chunk
                        _check_size(len(body), limit)
                    return _buffered(resp, bytes(body))
            except httpx.HTTPError as e:
                raise _transport_error(e) from e

        return self._check(_within(self._config.timeout, send), ok_statuses)

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
        """The async `request()`, with the same deadline and size limit."""
        _check_path(path)
        limit = self._config.max_response_bytes

        async def send() -> httpx.Response:
            try:
                async with self._transport.async_client.stream(
                    method, path, json=json, params=_clean(params), files=files, headers=self._extra_headers
                ) as resp:
                    _check_declared_size(resp, limit)
                    body = bytearray()
                    async for chunk in resp.aiter_bytes():
                        body += chunk
                        _check_size(len(body), limit)
                    return _buffered(resp, bytes(body))
            except httpx.HTTPError as e:
                raise _transport_error(e) from e

        timeout = self._config.timeout
        try:
            resp = await asyncio.wait_for(send(), timeout)
        except asyncio.TimeoutError:
            raise _timed_out(timeout) from None
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


def _timed_out(timeout: Optional[float]) -> IskraException:
    return IskraException(f"HTTP request timed out after {timeout:g}s", status_code=0)


def _too_large(limit: int) -> IskraException:
    return IskraException(f"HTTP response larger than max_response_bytes ({limit} bytes)", status_code=0)


def _check_declared_size(resp: httpx.Response, limit: int) -> None:
    """Refuses a body announced as too large before reading any of it."""
    length = resp.headers.get("content-length", "")
    if length.isdigit() and int(length) > limit:
        raise _too_large(limit)


def _check_size(size: int, limit: int) -> None:
    # Counted after decoding, so a small compressed body cannot inflate past it.
    if size > limit:
        raise _too_large(limit)


def _buffered(resp: httpx.Response, body: bytes) -> httpx.Response:
    """A response holding the body read from `resp`. The body is already
    decoded, so its Content-Encoding (and the encoded length) are dropped."""
    headers = [
        (name, value)
        for name, value in resp.headers.multi_items()
        if name.lower() not in ("content-encoding", "content-length", "transfer-encoding")
    ]
    return httpx.Response(resp.status_code, headers=headers, content=body, request=resp.request)


_T = TypeVar("_T")


def _within(timeout: Optional[float], work: Callable[[threading.Event], _T]) -> _T:
    """Runs `work` and gives up after `timeout` seconds.

    httpx's timeouts apply to each network operation, so a server sending a
    byte every few seconds (of the headers or of the body) kept a call open
    indefinitely: `timeout=2.0` took 9 s against one. The request runs on a
    helper thread that the caller stops waiting for at the deadline; `work`
    gets an event that is set then, and httpx's own timeouts bound how long
    the thread can outlive the call.
    """
    if timeout is None:
        return work(threading.Event())
    outcome: Dict[str, Any] = {}
    finished = threading.Event()
    cancelled = threading.Event()

    def run() -> None:
        try:
            outcome["value"] = work(cancelled)
        except BaseException as e:  # re-raised in the caller's thread
            outcome["error"] = e
        finally:
            finished.set()

    # In a copy of the caller's context, so context variables (tracing, for
    # instance) still reach the request.
    context = contextvars.copy_context()
    threading.Thread(target=context.run, args=(run,), name="iskra-request", daemon=True).start()
    if not finished.wait(timeout):
        cancelled.set()
        raise _timed_out(timeout)
    if "error" in outcome:
        raise outcome["error"]
    return outcome["value"]


def _clean(params: Optional[Mapping[str, Any]]) -> Optional[Dict[str, Any]]:
    if params is None:
        return None
    return {k: v for k, v in params.items() if v is not None}
