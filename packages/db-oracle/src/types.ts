/**
 * The parts of node-oracledb the driver uses. Declared here so that no
 * `oracledb` type is part of the package's public API (its types are not a
 * dependency), and so tests can stand in a fake pool.
 */

export interface OracleResultSetLike {
    getRows(count: number): Promise<unknown[]>;
    close(): Promise<void>;
}

export interface OracleRawResult {
    rows?: unknown[];
    rowsAffected?: number;
    outBinds?: unknown;
    resultSet?: OracleResultSetLike;
    /** node-oracledb's warning, e.g. NJS-700 for PL/SQL created with compilation errors. */
    warning?: { message?: string; code?: string; errorNum?: number };
}

export interface OracleConnectionLike {
    execute(sql: string, binds: unknown, options: Record<string, unknown>): Promise<OracleRawResult>;
    executeMany(
        sql: string,
        binds: unknown[],
        options: Record<string, unknown>,
    ): Promise<{ rowsAffected?: number; outBinds?: unknown[] }>;
    commit(): Promise<void>;
    rollback(): Promise<void>;
    /** `{ drop: true }` takes a pooled connection out of the pool. */
    close(options?: { drop?: boolean }): Promise<void>;
    /** Cancels the statement running on the connection (ORA-01013). */
    breakExecution?(): Promise<void>;
    /** Milliseconds a round trip may take before it is cancelled (NJS-123); 0 for no limit. */
    callTimeout?: number;
    /** The server version as a number, e.g. 1903000000 for 19.3, 2304000000 for 23.4. */
    readonly oracleServerVersion?: number;
}

export interface OraclePoolLike {
    getConnection(): Promise<OracleConnectionLike>;
    close(drainTime?: number): Promise<void>;
}

/**
 * A connection as the driver hands it out: `inTransaction` decides whether a
 * statement commits on its own (autoCommit), and `release` gives it back.
 * `broken` marks it to be dropped from the pool on release (after a timeout
 * or a lost connection).
 */
export interface ConnectionHandle {
    readonly connection: OracleConnectionLike;
    inTransaction: boolean;
    broken?: boolean;
    /**
     * A call on it ran past its deadline and still holds it: nothing else
     * runs on it, and it is dropped without waiting for that call.
     */
    lost?: boolean;
    /** A transaction's connection after it committed or rolled back. */
    ended?: boolean;
    /** Settles when the call running on the connection ends: the driver runs one at a time. */
    idle?: Promise<void>;
    release(): Promise<void>;
}
