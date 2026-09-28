import { IskraError, ErrorCodes } from '@iskra-bun/core';

type ErrorOptions = { cause?: Error; context?: Record<string, unknown> };

// ─── Connection Error ────────────────────────────────────────────────────────

/** start() could not create the pool or reach the database. */
export class ConnectionError extends IskraError {
    constructor(message: string, options?: ErrorOptions) {
        super(message, { code: ErrorCodes.CONNECTION_ERROR, ...options });
        this.name = 'ConnectionError';
    }
}

// ─── Query Error ─────────────────────────────────────────────────────────────

/**
 * A statement or transaction failed. For a database error, `context.errorNum`
 * holds its number (1 for ORA-00001, a unique constraint) and
 * `context.oracleCode` its code (`'ORA-00001'`); the original error is `cause`.
 */
export class QueryError extends IskraError {
    constructor(message: string, options?: ErrorOptions) {
        super(message, { code: ErrorCodes.QUERY_ERROR, ...options });
        this.name = 'QueryError';
    }

    /** The ORA error number of the failure, if the database reported one. */
    get errorNum(): number | undefined {
        const value = this.context.errorNum;
        return typeof value === 'number' ? value : undefined;
    }
}

// ─── Migration Error ─────────────────────────────────────────────────────────

export class MigrationError extends IskraError {
    constructor(message: string, options?: ErrorOptions) {
        super(message, { code: ErrorCodes.MIGRATION_ERROR, ...options });
        this.name = 'MigrationError';
    }
}

// ─── Query Input Error ───────────────────────────────────────────────────────

/**
 * A pagination cursor or a sort field from a request is not valid. It comes
 * from the client, so an HTTP handler answers 400 (web-kit's ValidationError).
 */
export class QueryInputError extends IskraError {
    constructor(message: string, options?: ErrorOptions) {
        super(message, { code: ErrorCodes.VALIDATION_ERROR, ...options });
        this.name = 'QueryInputError';
    }
}

/** Wraps a failed statement in a QueryError that carries its ORA code. */
export function toQueryError(error: unknown, message?: string): QueryError {
    if (error instanceof QueryError) return error;
    const cause = error instanceof Error ? error : new Error(String(error));
    const { errorNum, code } = cause as { errorNum?: unknown; code?: unknown };
    return new QueryError(message ?? (cause.message.split('\n')[0] || 'Oracle query failed'), {
        cause,
        context: {
            ...(typeof errorNum === 'number' ? { errorNum } : {}),
            ...(typeof code === 'string' && code.startsWith('ORA-') ? { oracleCode: code } : {}),
        },
    });
}
