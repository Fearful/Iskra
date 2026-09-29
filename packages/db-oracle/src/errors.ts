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
 * A statement or transaction failed. `context.errorCode` holds the code of
 * the database or the driver: `'ORA-00001'` (a unique constraint), or
 * node-oracledb's own, such as `'NJS-040'` (no free connection within
 * `pool.queueTimeout`) or `'NJS-123'` (`callTimeout` exceeded). For a
 * database error `context.errorNum` holds its number (1 for ORA-00001) and
 * `context.oracleCode` its code. The original error is `cause`.
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

    /** The database's or the driver's code: `'ORA-00001'`, `'NJS-040'`, `'NJS-123'`… */
    get errorCode(): string | undefined {
        const value = this.context.errorCode;
        return typeof value === 'string' ? value : undefined;
    }

    /** The statement ran out of time: node-oracledb's `callTimeout` (NJS-123) or the driver's deadline. */
    get timedOut(): boolean {
        return this.errorCode === 'NJS-123' || this.errorCode === 'DPI-1067';
    }
}

// ─── Deadline Error ──────────────────────────────────────────────────────────

/**
 * node-oracledb did not answer a call within its deadline (its timeout plus
 * `deadlineGrace`): the driver stopped waiting and dropped the connection
 * without waiting for the call. A transaction on that connection is lost.
 */
export class DeadlineError extends QueryError {
    constructor(readonly deadlineMs: number) {
        super(`Oracle did not answer within ${deadlineMs} ms: the call was given up and its connection dropped`, {
            context: { deadlineMs },
        });
        this.name = 'DeadlineError';
    }

    override get timedOut(): boolean {
        return true;
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
    const errorCode = typeof code === 'string' && /^(ORA|NJS|DPI|DPY)-\d+$/.test(code) ? code : undefined;
    return new QueryError(message ?? (cause.message.split('\n')[0] || 'Oracle query failed'), {
        cause,
        context: {
            ...(errorCode ? { errorCode } : {}),
            ...(typeof errorNum === 'number' && errorCode?.startsWith('ORA-') ? { errorNum } : {}),
            ...(errorCode?.startsWith('ORA-') ? { oracleCode: errorCode } : {}),
        },
    });
}
