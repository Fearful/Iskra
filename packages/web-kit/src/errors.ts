import { IskraError, ErrorCodes, type ErrorCode } from '@iskra-bun/core';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { codeForStatus } from './status-codes';

// ─── HTTP Errors ─────────────────────────────────────────────────────────────

/** What an HTTP error may carry besides its message. */
export interface HttpErrorOptions {
    cause?: Error;
    context?: Record<string, unknown>;
    /** Headers the error response carries (`Allow`, `WWW-Authenticate`, `Retry-After`). */
    headers?: Record<string, string>;
}

export class HttpError extends IskraError {
    public readonly status: number;
    /** Headers the error response carries (`Allow`, `WWW-Authenticate`, `Retry-After`). */
    public readonly headers?: Record<string, string>;

    constructor(status: number, message: string, options?: HttpErrorOptions & { code?: ErrorCode }) {
        super(message, {
            // The status's code (429 → RATE_LIMITED) unless one is given.
            code: options?.code ?? codeForStatus(status),
            cause: options?.cause,
            context: options?.context,
        });
        this.name = 'HttpError';
        this.status = status;
        if (options?.headers) this.headers = options.headers;
    }

    toHTTPException(): HTTPException {
        return new HTTPException(this.status as ContentfulStatusCode, { message: this.message, cause: this });
    }
}

// ─── Validation Error ────────────────────────────────────────────────────────

export class ValidationError extends HttpError {
    public readonly details: unknown;

    constructor(message: string, details?: unknown, options?: HttpErrorOptions) {
        super(400, message, { code: ErrorCodes.VALIDATION_ERROR, ...options });
        this.name = 'ValidationError';
        this.details = details;
    }
}

// ─── Auth Error ──────────────────────────────────────────────────────────────

export class AuthError extends HttpError {
    constructor(message: string = 'Unauthorized', options?: HttpErrorOptions) {
        super(401, message, { code: ErrorCodes.UNAUTHORIZED, ...options });
        this.name = 'AuthError';
    }
}

// ─── Forbidden Error ─────────────────────────────────────────────────────────

export class ForbiddenError extends HttpError {
    constructor(message: string = 'Forbidden', options?: HttpErrorOptions) {
        super(403, message, { code: ErrorCodes.FORBIDDEN, ...options });
        this.name = 'ForbiddenError';
    }
}

// ─── Not Found Error ─────────────────────────────────────────────────────────

export class NotFoundError extends HttpError {
    constructor(message: string = 'Not Found', options?: HttpErrorOptions) {
        super(404, message, { code: ErrorCodes.NOT_FOUND, ...options });
        this.name = 'NotFoundError';
    }
}

// ─── Conflict Error ──────────────────────────────────────────────────────────

export class ConflictError extends HttpError {
    constructor(message: string = 'Conflict', options?: HttpErrorOptions) {
        super(409, message, { code: ErrorCodes.CONFLICT, ...options });
        this.name = 'ConflictError';
    }
}
