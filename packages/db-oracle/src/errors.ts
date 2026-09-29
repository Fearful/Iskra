import { IskraError, ErrorCodes, type ErrorCode } from '@iskra-bun/core';

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
 *
 * Its `code` tells an HTTP handler (web-kit's response contract) how to
 * answer: `TIMEOUT` (504) for NJS-123 and a DeadlineError,
 * `SERVICE_UNAVAILABLE` (503) for NJS-040, `CONFLICT` (409) for ORA-00001,
 * `QUERY_ERROR` (500) for the rest. The message stays server-side.
 */
export class QueryError extends IskraError {
    constructor(message: string, options?: ErrorOptions & { code?: ErrorCode }) {
        super(message, { ...options, code: options?.code ?? codeOf(options?.context?.errorCode) });
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

    /**
     * A PL/SQL `RAISE_APPLICATION_ERROR` (ORA-20000 to ORA-20999): its number
     * and message, without the `ORA-20xxx:` prefix and the `ORA-06512` stack
     * lines. Its code is `CONFLICT` (409), and the message is for the client.
     */
    get applicationError(): { number: number; message: string } | undefined {
        const num = this.errorNum;
        if (num === undefined || num < 20000 || num > 20999) return undefined;
        return { number: num, message: this.message };
    }

    /** Whether web-kit shows the message to the client: a PL/SQL application error's. */
    get expose(): boolean {
        return this.applicationError !== undefined;
    }
}

/** The error code of a database or driver code (`'NJS-123'`…). */
function codeOf(errorCode: unknown): ErrorCode {
    switch (errorCode) {
        case 'NJS-123':
        case 'DPI-1067':
            return ErrorCodes.TIMEOUT;
        case 'NJS-040':
            return ErrorCodes.SERVICE_UNAVAILABLE;
        case 'ORA-00001':
            return ErrorCodes.CONFLICT;
        default:
            // RAISE_APPLICATION_ERROR: a business rule of a stored procedure.
            return typeof errorCode === 'string' && /^ORA-20\d{3}$/.test(errorCode)
                ? ErrorCodes.CONFLICT
                : ErrorCodes.QUERY_ERROR;
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
            code: ErrorCodes.TIMEOUT,
            context: { deadlineMs },
        });
        this.name = 'DeadlineError';
    }

    override get timedOut(): boolean {
        return true;
    }
}

// ─── No Rows Error ───────────────────────────────────────────────────────────

/** `one()` found no row: `NOT_FOUND`, which web-kit answers with a 404. */
export class NoRowsError extends QueryError {
    constructor(message = 'No rows') {
        super(message, { code: ErrorCodes.NOT_FOUND });
        this.name = 'NoRowsError';
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
 * from the client, so web-kit answers 400 with its message (`expose`).
 */
export class QueryInputError extends IskraError {
    /** Its message is meant for the client. */
    readonly expose = true;

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
    const firstLine = cause.message.split('\n')[0] ?? '';
    // A stored procedure's own message, for the client: without `ORA-20xxx: `.
    const application = /^ORA-20\d{3}$/.test(errorCode ?? '') ? firstLine.replace(/^ORA-\d{5}:\s*/, '') : undefined;
    return new QueryError(message ?? (application || firstLine || 'Oracle query failed'), {
        cause,
        context: {
            ...(errorCode ? { errorCode } : {}),
            ...(typeof errorNum === 'number' && errorCode?.startsWith('ORA-') ? { errorNum } : {}),
            ...(errorCode?.startsWith('ORA-') ? { oracleCode: errorCode } : {}),
        },
    });
}
