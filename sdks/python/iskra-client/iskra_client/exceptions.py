from __future__ import annotations
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any, Mapping, Optional


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
    def from_error_response(
        status_code: int, body: Any, headers: Optional[Mapping[str, str]] = None
    ) -> IskraException:
        """Maps an error response to a typed exception.

        Understands the shapes an Iskra service answers with:
        `{"error", "code", "details"}` (ErrorHandlerFeature / errorResponse),
        `{"message", "code"}` (Better Auth and the Kernel's default handler),
        and a plain-text body (e.g. Hono's `404 Not Found`). A 429's
        `Retry-After` header, when `headers` are given, becomes `retry_after`.
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

        if status_code == 429:
            return RateLimitException(
                message=message or f"HTTP {status_code}",
                status_code=status_code,
                error_code=code,
                details=details,
                request_id=request_id,
                retry_after=parse_retry_after(
                    next((v for k, v in (headers or {}).items() if k.lower() == "retry-after"), None)
                ),
            )
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
    def __init__(self, *args: Any, retry_after: Optional[float] = None, **kwargs: Any):
        super().__init__(*args, **kwargs)
        #: Seconds to wait before retrying, from the response's `Retry-After`
        #: header; None when it is absent or invalid.
        self.retry_after = retry_after


def parse_retry_after(value: Optional[str]) -> Optional[float]:
    """A `Retry-After` value (delay in seconds or an HTTP-date) in seconds
    from now, never negative; None when absent or invalid."""
    if value is None:
        return None
    value = value.strip()
    if value.isascii() and value.isdigit():
        return float(value)
    try:
        when = parsedate_to_datetime(value)
    except (TypeError, ValueError, IndexError):
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    return max(0.0, (when - datetime.now(timezone.utc)).total_seconds())


_STATUS_CLASSES = {
    400: ValidationException,
    401: AuthException,
    403: ForbiddenException,
    404: NotFoundException,
    409: ConflictException,
    429: RateLimitException,
}
