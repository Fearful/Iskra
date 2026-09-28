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
}

export interface OracleConnectionLike {
    execute(sql: string, binds: unknown, options: Record<string, unknown>): Promise<OracleRawResult>;
    executeMany(sql: string, binds: unknown[], options: Record<string, unknown>): Promise<{ rowsAffected?: number }>;
    commit(): Promise<void>;
    rollback(): Promise<void>;
    close(): Promise<void>;
}

export interface OraclePoolLike {
    getConnection(): Promise<OracleConnectionLike>;
    close(drainTime?: number): Promise<void>;
}

/**
 * A connection as the driver hands it out: `inTransaction` decides whether a
 * statement commits on its own (autoCommit), and `release` gives it back.
 */
export interface ConnectionHandle {
    readonly connection: OracleConnectionLike;
    inTransaction: boolean;
    release(): Promise<void>;
}
