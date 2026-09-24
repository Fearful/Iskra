from __future__ import annotations
from typing import Dict, Optional, TYPE_CHECKING, Union

import httpx

from iskra_client.auth.models import Session
from iskra_client.responses import IskraResponse
from iskra_client.http_client import parse_body

if TYPE_CHECKING:
    from iskra_client.http_client import HttpClientWrapper

SessionLike = Union[Session, str]


def session_cookie(session: SessionLike) -> str:
    """The Cookie header value for a Session or an already-extracted cookie."""
    if isinstance(session, Session):
        if not session.cookie:
            raise ValueError("Session has no cookie (it did not come from sign_in/sign_up)")
        return session.cookie
    return session


def _session_cookie_from(resp: httpx.Response) -> Optional[str]:
    """Picks Better Auth's session-token cookie out of the Set-Cookie headers.

    Only the token is kept: the `session_data` cookie is a signed cache that
    keeps a signed-out session valid until it expires (5 min by default),
    whereas the token is checked against the database on every request.
    """
    cookies: Dict[str, str] = {}
    for header in resp.headers.get_list("set-cookie"):
        # "name=value; Attr=...": only the pair before the first ";" matters.
        name, sep, value = header.split(";", 1)[0].strip().partition("=")
        if sep and name and value:
            cookies[name] = value
    tokens = {k: v for k, v in cookies.items() if k.endswith("session_token")}
    if not tokens:
        return None
    return "; ".join(f"{k}={v}" for k, v in tokens.items())


class AuthClient:
    def __init__(self, http: HttpClientWrapper, base_path: str = "/api/sso") -> None:
        self._http = http
        self._base_path = base_path

    def _as(self, session: Optional[SessionLike]) -> HttpClientWrapper:
        return self._http if session is None else self._http.bind_cookie(session_cookie(session))

    # ── Sync ─────────────────────────────────────────────────────────────

    def sign_in(self, email: str, password: str) -> IskraResponse[Session]:
        resp = self._http.request(
            "POST", f"{self._base_path}/sign-in/email", json={"email": email, "password": password}
        )
        return self._session_response(resp)

    def sign_up(self, email: str, password: str, name: Optional[str] = None) -> IskraResponse[Session]:
        # Better Auth requires `name`; default it to the email's local part.
        body = {"email": email, "password": password, "name": name or email.split("@")[0]}
        resp = self._http.request("POST", f"{self._base_path}/sign-up/email", json=body)
        return self._session_response(resp)

    def get_session(self, session: Optional[SessionLike] = None) -> IskraResponse[Session]:
        """The session behind `session` (or the one this client is bound to);
        `data` is None when there is none or it expired / was signed out."""
        http = self._as(session)
        resp = http.request("GET", f"{self._base_path}/get-session")
        return self._session_response(resp, capture_cookie=False, cookie=http.cookie)

    def sign_out(self, session: Optional[SessionLike] = None) -> IskraResponse:
        resp = self._as(session).request("POST", f"{self._base_path}/sign-out")
        return self._http._handle(resp)

    # ── Async ────────────────────────────────────────────────────────────

    async def async_sign_in(self, email: str, password: str) -> IskraResponse[Session]:
        resp = await self._http.async_request(
            "POST", f"{self._base_path}/sign-in/email", json={"email": email, "password": password}
        )
        return self._session_response(resp)

    async def async_sign_up(self, email: str, password: str, name: Optional[str] = None) -> IskraResponse[Session]:
        body = {"email": email, "password": password, "name": name or email.split("@")[0]}
        resp = await self._http.async_request("POST", f"{self._base_path}/sign-up/email", json=body)
        return self._session_response(resp)

    async def async_get_session(self, session: Optional[SessionLike] = None) -> IskraResponse[Session]:
        http = self._as(session)
        resp = await http.async_request("GET", f"{self._base_path}/get-session")
        return self._session_response(resp, capture_cookie=False, cookie=http.cookie)

    async def async_sign_out(self, session: Optional[SessionLike] = None) -> IskraResponse:
        resp = await self._as(session).async_request("POST", f"{self._base_path}/sign-out")
        return self._http._handle(resp)

    # ── Helpers ──────────────────────────────────────────────────────────

    def _session_response(
        self, resp: httpx.Response, capture_cookie: bool = True, cookie: Optional[str] = None
    ) -> IskraResponse[Session]:
        body = parse_body(resp)
        if not isinstance(body, dict):
            return IskraResponse(success=True, data=None, status_code=resp.status_code)
        # get_session(session) returned a Session without its cookie: it read
        # the unbound client's (None) instead of the session's.
        if capture_cookie:
            cookie = _session_cookie_from(resp)
        elif cookie is None:
            cookie = self._http.cookie
        return IskraResponse(
            success=True,
            data=Session.from_dict(body, cookie=cookie),
            status_code=resp.status_code,
        )
