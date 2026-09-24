from __future__ import annotations
from dataclasses import dataclass
from typing import Optional


@dataclass
class SessionInfo:
    id: str = ""
    expires_at: Optional[str] = None
    token: Optional[str] = None

    @classmethod
    def from_dict(cls, raw: dict) -> SessionInfo:
        return cls(
            id=raw.get("id", ""),
            expires_at=raw.get("expiresAt"),
            token=raw.get("token"),
        )


@dataclass
class UserInfo:
    id: str = ""
    email: Optional[str] = None
    name: Optional[str] = None
    image: Optional[str] = None
    email_verified: bool = False

    @classmethod
    def from_dict(cls, raw: dict) -> UserInfo:
        return cls(
            id=raw.get("id", ""),
            email=raw.get("email"),
            name=raw.get("name"),
            image=raw.get("image"),
            email_verified=bool(raw.get("emailVerified", False)),
        )


@dataclass
class Session:
    session: Optional[SessionInfo] = None
    user: Optional[UserInfo] = None
    # The Cookie header value that authenticates as this session, captured
    # from the sign-in / sign-up response. Pass the Session (or this string)
    # to IskraClient.with_session() to make requests as the user; keep it
    # server-side, it is as sensitive as the user's password.
    cookie: Optional[str] = None

    @classmethod
    def from_dict(cls, raw: dict, cookie: Optional[str] = None) -> Session:
        """Accepts both `{"session", "user"}` (get-session) and
        `{"token", "user"}` (sign-in / sign-up) bodies."""
        session_data = raw.get("session")
        user_data = raw.get("user")
        if isinstance(session_data, dict):
            session = SessionInfo.from_dict(session_data)
        elif raw.get("token"):
            session = SessionInfo(token=raw["token"])
        else:
            session = None
        return cls(
            session=session,
            user=UserInfo.from_dict(user_data) if isinstance(user_data, dict) else None,
            cookie=cookie,
        )
