from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any, Generic, Optional, TypeVar

T = TypeVar("T")


@dataclass
class IskraResponse(Generic[T]):
    success: bool = False
    data: Optional[T] = None
    message: Optional[str] = None

    @classmethod
    def from_dict(cls, raw: dict) -> IskraResponse:
        return cls(
            success=raw.get("success", False),
            data=raw.get("data"),
            message=raw.get("message"),
        )
