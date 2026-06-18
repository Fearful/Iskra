from __future__ import annotations
from typing import Optional, TYPE_CHECKING

from iskra_client.auth.models import Session
from iskra_client.responses import IskraResponse

if TYPE_CHECKING:
    from iskra_client.http_client import HttpClientWrapper


class AuthClient:
    def __init__(self, http: HttpClientWrapper, base_path: str = "/api/sso") -> None:
        self._http = http
        self._base_path = base_path

    # ── Sync ─────────────────────────────────────────────────────────────

    def sign_in(self, email: str, password: str) -> IskraResponse:
        resp = self._http.post(
            f"{self._base_path}/sign-in/email",
            json={"email": email, "password": password},
        )
        return self._parse(resp)

    def sign_up(self, email: str, password: str, name: Optional[str] = None) -> IskraResponse:
        body = {"email": email, "password": password}
        if name:
            body["name"] = name
        resp = self._http.post(f"{self._base_path}/sign-up/email", json=body)
        return self._parse(resp)

    def sign_out(self) -> IskraResponse:
        return self._http.post(f"{self._base_path}/sign-out")

    def get_session(self) -> IskraResponse:
        resp = self._http.get(f"{self._base_path}/get-session")
        return self._parse(resp)

    # ── Async ────────────────────────────────────────────────────────────

    async def async_sign_in(self, email: str, password: str) -> IskraResponse:
        resp = await self._http.async_post(
            f"{self._base_path}/sign-in/email",
            json={"email": email, "password": password},
        )
        return self._parse(resp)

    async def async_sign_up(self, email: str, password: str, name: Optional[str] = None) -> IskraResponse:
        body = {"email": email, "password": password}
        if name:
            body["name"] = name
        resp = await self._http.async_post(f"{self._base_path}/sign-up/email", json=body)
        return self._parse(resp)

    async def async_sign_out(self) -> IskraResponse:
        return await self._http.async_post(f"{self._base_path}/sign-out")

    async def async_get_session(self) -> IskraResponse:
        resp = await self._http.async_get(f"{self._base_path}/get-session")
        return self._parse(resp)

    # ── Helpers ──────────────────────────────────────────────────────────

    @staticmethod
    def _parse(resp: IskraResponse) -> IskraResponse:
        if resp.data and isinstance(resp.data, dict):
            resp.data = Session.from_dict(resp.data)
        return resp
