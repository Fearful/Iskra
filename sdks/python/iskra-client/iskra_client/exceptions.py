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
    def from_error_response(status_code: int, body: Any) -> IskraException:
        """Maps an error response to a typed exception.

        Understands the shapes an Iskra service answers with:
        `{"error", "code", "details"}` (ErrorHandlerFeature / errorResponse),
        `{"message", "code"}` (Better Auth and the Kernel's default handler),
        and a plain-text body (e.g. Hono's `404 Not Found`).
        """
        message: Optional[str] = None
        code = details = request_id = None
        if isinstance(body, dict):
            error = body.get("error")
            if isinstance(error, dict):
                message = error.get("message")
                code = error.get("code")
            elif isinstance(error, str):
                message = error
            message = message or body.get("message")
            code = code or body.get("code")
            details = body.get("details", body.get("context"))
            request_id = body.get("requestId")
        elif isinstance(body, str) and body.strip():
            message = body.strip()

        cls = _STATUS_CLASSES.get(status_code, IskraException)
        return cls(
            message=message or f"HTTP {status_code}",
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


class ConflictException(IskraException):
    pass


class RateLimitException(IskraException):
    pass


_STATUS_CLASSES = {
    400: ValidationException,
    401: AuthException,
    403: ForbiddenException,
    404: NotFoundException,
    409: ConflictException,
    429: RateLimitException,
}
