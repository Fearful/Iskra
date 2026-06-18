from __future__ import annotations
from typing import Any, Optional


class IskraException(Exception):
    def __init__(
        self,
        message: str,
        status_code: int = 0,
        error_code: Optional[str] = None,
        details: Any = None,
        request_id: Optional[str] = None,
    ):
        super().__init__(message)
        self.status_code = status_code
        self.error_code = error_code
        self.details = details
        self.request_id = request_id

    @staticmethod
    def from_error_response(status_code: int, body: dict) -> IskraException:
        message = body.get("error", "Unknown error")
        code = body.get("code")
        details = body.get("details")
        request_id = body.get("requestId")

        cls_map = {
            400: ValidationException,
            401: AuthException,
            403: ForbiddenException,
            404: NotFoundException,
            429: RateLimitException,
        }

        cls = cls_map.get(status_code, IskraException)
        return cls(
            message=message,
            status_code=status_code,
            error_code=code,
            details=details,
            request_id=request_id,
        )


class ValidationException(IskraException):
    pass


class AuthException(IskraException):
    pass


class ForbiddenException(IskraException):
    pass


class NotFoundException(IskraException):
    pass


class RateLimitException(IskraException):
    pass
