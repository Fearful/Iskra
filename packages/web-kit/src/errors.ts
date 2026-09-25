import { IskraError, ErrorCodes, type ErrorCode } from '@iskra-bun/core';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from "hono/utils/http-status";

// ─── HTTP Errors ─────────────────────────────────────────────────────────────

export class HttpError extends IskraError {
    public readonly status: number;

    constructor(status: number, message: string, options?: { code?: ErrorCode; cause?: Error; context?: Record<string, unknown> }) {
        super(message, { code: options?.code ?? ErrorCodes.INTERNAL_ERROR, cause: options?.cause, context: options?.context });
        this.name = 'HttpError';
        this.status = status;
    }

    toHTTPException(): HTTPException {
        return new HTTPException(this.status as ContentfulStatusCode, { message: this.message, cause: this });
    }
}

// ─── Validation Error ────────────────────────────────────────────────────────

export class ValidationError extends HttpError {
    public readonly details: unknown;

    constructor(message: string, details?: unknown, options?: { cause?: Error; context?: Record<string, unknown> }) {
        super(400, message, { code: ErrorCodes.VALIDATION_ERROR, ...options });
        this.name = 'ValidationError';
        this.details = details;
    }
}

// ─── Auth Error ──────────────────────────────────────────────────────────────

export class AuthError extends HttpError {
    constructor(message: string = 'Unauthorized', options?: { cause?: Error; context?: Record<string, unknown> }) {
        super(401, message, { code: ErrorCodes.UNAUTHORIZED, ...options });
        this.name = 'AuthError';
    }
}

// ─── Forbidden Error ─────────────────────────────────────────────────────────

export class ForbiddenError extends HttpError {
    constructor(message: string = 'Forbidden', options?: { cause?: Error; context?: Record<string, unknown> }) {
        super(403, message, { code: ErrorCodes.FORBIDDEN, ...options });
        this.name = 'ForbiddenError';
    }
}

// ─── Not Found Error ─────────────────────────────────────────────────────────

export class NotFoundError extends HttpError {
    constructor(message: string = 'Not Found', options?: { cause?: Error; context?: Record<string, unknown> }) {
        super(404, message, { code: ErrorCodes.NOT_FOUND, ...options });
        this.name = 'NotFoundError';
    }
}

// ─── Conflict Error ──────────────────────────────────────────────────────────

export class ConflictError extends HttpError {
    constructor(message: string = 'Conflict', options?: { cause?: Error; context?: Record<string, unknown> }) {
        super(409, message, { code: ErrorCodes.CONFLICT, ...options });
        this.name = 'ConflictError';
    }
}
