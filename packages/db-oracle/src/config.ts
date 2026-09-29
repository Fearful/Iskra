import { ConfigError } from '@iskra-bun/core';

/** Column types read as strings instead of a JS number or Date. */
export type OracleFetchAsString = 'number' | 'date';

export interface OraclePoolConfig {
    /** Connections kept open while idle. Default 0. */
    min?: number;
    /** Most connections open at once. Default 4. */
    max?: number;
    /** Connections opened at a time when the pool grows. Default 1. */
    increment?: number;
    /** Milliseconds a request waits for a free connection before failing (NJS-040). Default 60000. */
    queueTimeout?: number;
    /** Seconds stop() lets connections in use finish before closing them. Default 5. */
    drainTime?: number;
}

/** `app.config.oracle`. Without it, the driver reads ORA_CONN, ORA_USER and ORA_PASSWORD. */
export interface OracleConfig {
    /** Easy Connect (`host:1521/FREEPDB1`, `tcps://…`), a TNS alias or a full descriptor. */
    connectString: string;
    user?: string;
    password?: string;
    pool?: OraclePoolConfig;
    /**
     * Column types fetched as strings: `'number'` for NUMBERs past 2^53, which
     * lose digits as a JS number; `'date'` for DATE and TIMESTAMP as Oracle
     * formats them. CLOBs are always strings and BLOBs Buffers: a Lob can only
     * be read while its connection is open, and the pool takes it back first.
     */
    fetchAsString?: OracleFetchAsString[];
    /**
     * Kysely only: write tables and columns in camelCase (`firstName`) for
     * Oracle's UPPER_SNAKE_CASE (`FIRST_NAME`), and read rows back in camelCase.
     */
    camelCase?: boolean;
    /** Other node-oracledb pool attributes (walletLocation, configDir…), passed as they are. */
    poolAttributes?: Record<string, unknown>;
    /**
     * Milliseconds a statement may run (each round trip to the database)
     * before it is cancelled with a QueryError NJS-123, and its connection
     * dropped from the pool. Default 30000; 0 for no limit. A statement
     * waiting on a lock otherwise holds its connection forever.
     */
    callTimeout?: number;
    /** Milliseconds ping() waits, for a free connection and SELECT 1, before answering false. Default 5000. */
    pingTimeout?: number;
    /**
     * Leave out the binds by name that the SQL does not use, instead of
     * failing (NJS-097/NJS-098). Default false. Also a per-call option.
     */
    dropUnusedBinds?: boolean;
    /**
     * The oldest database the Kysely SQL must run on. `'19c'` (the default)
     * refuses at compile time what only 23ai understands: booleans in SQL
     * and multi-row VALUES. `'23ai'` allows them.
     */
    compatibility?: OracleCompatibility;
}

export type OracleCompatibility = '19c' | '23ai';

declare module '@iskra-bun/core' {
    interface AppConfig {
        oracle?: OracleConfig;
    }
}

export interface ResolvedOracleConfig {
    connectString: string;
    user?: string;
    password?: string;
    pool: Required<OraclePoolConfig>;
    fetchAsString: ReadonlySet<OracleFetchAsString>;
    camelCase: boolean;
    poolAttributes: Record<string, unknown>;
    callTimeout: number;
    pingTimeout: number;
    dropUnusedBinds: boolean;
    compatibility: OracleCompatibility;
}

const POOL_DEFAULTS: Required<OraclePoolConfig> = { min: 0, max: 4, increment: 1, queueTimeout: 60_000, drainTime: 5 };
const FETCH_AS_STRING = ['number', 'date'] as const;

function invalid(message: string): never {
    throw new ConfigError(`Invalid oracle config: ${message}`);
}

function optionalString(section: Record<string, unknown>, key: string): string | undefined {
    const value = section[key];
    if (value === undefined) return undefined;
    if (typeof value !== 'string') invalid(`${key} must be a string`);
    return value;
}

function typeList<T extends string>(value: unknown, key: string, allowed: readonly T[], fallback: T[]): Set<T> {
    if (value === undefined) return new Set(fallback);
    if (!Array.isArray(value) || value.some((v) => !allowed.includes(v))) {
        invalid(`${key} must be a list of ${allowed.map((a) => `'${a}'`).join(', ')}`);
    }
    return new Set(value as T[]);
}

function milliseconds(section: Record<string, unknown>, key: string, fallback: number): number {
    const value = section[key];
    if (value === undefined) return fallback;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) invalid(`${key} must be an integer >= 0`);
    return value;
}

function poolConfig(value: unknown): Required<OraclePoolConfig> {
    if (value === undefined) return { ...POOL_DEFAULTS };
    if (typeof value !== 'object' || value === null) invalid('pool must be an object');
    const pool = { ...POOL_DEFAULTS };
    for (const key of Object.keys(POOL_DEFAULTS) as (keyof OraclePoolConfig)[]) {
        const v = (value as Record<string, unknown>)[key];
        if (v === undefined) continue;
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) invalid(`pool.${key} must be an integer >= 0`);
        pool[key] = v;
    }
    if (pool.max < 1) invalid('pool.max must be at least 1');
    if (pool.min > pool.max) invalid('pool.min cannot be larger than pool.max');
    if (pool.increment < 1) invalid('pool.increment must be at least 1');
    return pool;
}

/**
 * The driver's settings: `app.config.oracle` when present (validated), else
 * the ORA_* variables, else undefined (the driver does not start).
 */
export function resolveConfig(
    section: unknown,
    env: Record<string, string | undefined> = process.env,
): ResolvedOracleConfig | undefined {
    if (section === undefined) {
        if (!env.ORA_CONN) return undefined;
        section = { connectString: env.ORA_CONN, user: env.ORA_USER, password: env.ORA_PASSWORD };
    }
    if (typeof section !== 'object' || section === null || Array.isArray(section)) invalid('expected an object');
    const s = section as Record<string, unknown>;
    const connectString = optionalString(s, 'connectString');
    if (!connectString) invalid('connectString is required');
    for (const key of ['camelCase', 'dropUnusedBinds']) {
        if (s[key] !== undefined && typeof s[key] !== 'boolean') invalid(`${key} must be a boolean`);
    }
    const compatibility = s.compatibility ?? '19c';
    if (compatibility !== '19c' && compatibility !== '23ai') invalid("compatibility must be '19c' or '23ai'");
    const poolAttributes = s.poolAttributes ?? {};
    if (typeof poolAttributes !== 'object' || poolAttributes === null) invalid('poolAttributes must be an object');
    return {
        connectString,
        user: optionalString(s, 'user'),
        password: optionalString(s, 'password'),
        pool: poolConfig(s.pool),
        fetchAsString: typeList(s.fetchAsString, 'fetchAsString', FETCH_AS_STRING, []),
        camelCase: s.camelCase === true,
        poolAttributes: poolAttributes as Record<string, unknown>,
        callTimeout: milliseconds(s, 'callTimeout', 30_000),
        pingTimeout: milliseconds(s, 'pingTimeout', 5000),
        dropUnusedBinds: s.dropUnusedBinds === true,
        compatibility,
    };
}
