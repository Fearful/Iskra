import { ErrorCodes, type ErrorCode } from '@iskra-bun/core';

const STATUS_OF: Partial<Record<ErrorCode, number>> = {
    [ErrorCodes.BAD_REQUEST]: 400,
    [ErrorCodes.VALIDATION_ERROR]: 400,
    [ErrorCodes.UNAUTHORIZED]: 401,
    [ErrorCodes.FORBIDDEN]: 403,
    [ErrorCodes.NOT_FOUND]: 404,
    [ErrorCodes.FILE_NOT_FOUND]: 404,
    [ErrorCodes.METHOD_NOT_ALLOWED]: 405,
    [ErrorCodes.CONFLICT]: 409,
    [ErrorCodes.PAYLOAD_TOO_LARGE]: 413,
    [ErrorCodes.UNSUPPORTED_MEDIA_TYPE]: 415,
    [ErrorCodes.RATE_LIMITED]: 429,
    [ErrorCodes.SERVICE_UNAVAILABLE]: 503,
    [ErrorCodes.TIMEOUT]: 504,
};

const CODE_OF: Record<number, ErrorCode> = {
    400: ErrorCodes.BAD_REQUEST,
    401: ErrorCodes.UNAUTHORIZED,
    403: ErrorCodes.FORBIDDEN,
    404: ErrorCodes.NOT_FOUND,
    405: ErrorCodes.METHOD_NOT_ALLOWED,
    409: ErrorCodes.CONFLICT,
    413: ErrorCodes.PAYLOAD_TOO_LARGE,
    415: ErrorCodes.UNSUPPORTED_MEDIA_TYPE,
    422: ErrorCodes.VALIDATION_ERROR,
    429: ErrorCodes.RATE_LIMITED,
    503: ErrorCodes.SERVICE_UNAVAILABLE,
    504: ErrorCodes.TIMEOUT,
};

/** The HTTP status an error code answers with: `NOT_FOUND` → 404; 500 for codes with none. */
export function statusForCode(code: ErrorCode): number {
    return STATUS_OF[code] ?? 500;
}

/** The error code of an HTTP status: 404 → `NOT_FOUND`; `BAD_REQUEST` or `INTERNAL_ERROR` for the rest. */
export function codeForStatus(status: number): ErrorCode {
    return CODE_OF[status] ?? (status < 500 ? ErrorCodes.BAD_REQUEST : ErrorCodes.INTERNAL_ERROR);
}
