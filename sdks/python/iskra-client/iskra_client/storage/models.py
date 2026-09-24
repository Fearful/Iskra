from __future__ import annotations
from dataclasses import dataclass
from typing import Optional


@dataclass
class UploadedFile:
    """What the service stored for an upload. `filename` is the name the
    service actually used: it reduces names to `[A-Za-z0-9._-]`."""

    path: str = ""
    filename: str = ""
    size: int = 0
    uploaded_at: Optional[str] = None

    @classmethod
    def from_dict(cls, raw: dict) -> UploadedFile:
        return cls(
            path=raw.get("path", ""),
            filename=raw.get("filename", ""),
            size=int(raw.get("size", 0)),
            uploaded_at=raw.get("uploadedAt"),
        )


@dataclass
class StoredFile:
    name: str = ""
    path: str = ""
    size: int = 0
    mime_type: Optional[str] = None
    last_modified: Optional[str] = None
    url: Optional[str] = None

    @classmethod
    def from_dict(cls, raw: dict) -> StoredFile:
        return cls(
            name=raw.get("name", ""),
            path=raw.get("path", ""),
            size=int(raw.get("size", 0)),
            mime_type=raw.get("mimeType"),
            last_modified=raw.get("lastModified"),
            url=raw.get("url"),
        )
