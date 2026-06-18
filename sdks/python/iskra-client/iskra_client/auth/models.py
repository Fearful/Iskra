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

    @classmethod
    def from_dict(cls, raw: dict) -> UserInfo:
        return cls(
            id=raw.get("id", ""),
            email=raw.get("email"),
            name=raw.get("name"),
            image=raw.get("image"),
        )


@dataclass
class Session:
    session: Optional[SessionInfo] = None
    user: Optional[UserInfo] = None

    @classmethod
    def from_dict(cls, raw: dict) -> Session:
        session_data = raw.get("session")
        user_data = raw.get("user")
        return cls(
            session=SessionInfo.from_dict(session_data) if session_data else None,
            user=UserInfo.from_dict(user_data) if user_data else None,
        )
