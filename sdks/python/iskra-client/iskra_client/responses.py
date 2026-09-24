from __future__ import annotations
from dataclasses import dataclass
from typing import Generic, Optional, TypeVar

T = TypeVar("T")

_ENVELOPE_KEYS = ("success", "message")


@dataclass
class IskraResponse(Generic[T]):
    success: bool = False
    data: Optional[T] = None
    message: Optional[str] = None
    status_code: int = 0

    @classmethod
    def from_dict(cls, raw: dict, status_code: int = 0) -> IskraResponse:
        """Builds a response from a `{"success": ..., ...}` body.

        `successResponse()` puts the payload under `data`; other Iskra routes
        (e.g. the upload routes) put it next to `success`, so those fields
        become `data` instead of being dropped.
        """
        if "data" in raw:
            data = raw["data"]
        else:
            data = {k: v for k, v in raw.items() if k not in _ENVELOPE_KEYS} or None
        return cls(
            success=bool(raw.get("success", False)),
            data=data,
            message=raw.get("message"),
            status_code=status_code,
        )
