import type * as OracleDB from 'oracledb';
import type { OracleFetchAsString } from './config';

type OracledbModule = typeof OracleDB;

/** Oracle types by name, for typed and out binds. */
export type OracleType = 'string' | 'number' | 'date' | 'timestamp' | 'clob' | 'blob' | 'raw' | 'boolean';

/** An IN bind with an explicit type: `{ type: 'clob', val: longText }`. */
export interface OracleTypedBind<T extends OracleType = OracleType> {
    dir?: 'in';
    type: T;
    val: unknown;
    maxSize?: number;
}

/** A PL/SQL OUT parameter: `outBinds.name` is its value (or null). */
export interface OracleOutBind<T extends OracleType = OracleType> {
    dir: 'out';
    type: T;
    /** Bytes for `string` (default 4000) and `raw` (default 2000). */
    maxSize?: number;
}

/** A PL/SQL IN OUT parameter. */
export interface OracleInOutBind<T extends OracleType = OracleType> {
    dir: 'inout';
    type: T;
    val: unknown;
    maxSize?: number;
}

/**
 * A `RETURNING … INTO :name` target of an INSERT, UPDATE or DELETE:
 * `outBinds.name` is an array with one value per affected row.
 */
export interface OracleReturningBind<T extends OracleType = OracleType> {
    dir: 'returning';
    type: T;
    maxSize?: number;
}

export type OracleBindSpec = OracleTypedBind | OracleOutBind | OracleInOutBind | OracleReturningBind;

export type OracleBindValue =
    | string
    | number
    | bigint
    | boolean
    | Date
    | Uint8Array
    | null
    | undefined
    | OracleBindSpec;

/** Binds by name (`:id` ↔ `{ id }`) or by position (`:1`, `:2` ↔ `[a, b]`). */
export type OracleBinds = Readonly<Record<string, OracleBindValue>> | readonly OracleBindValue[];

/** The JS value of an Oracle type (CLOBs and BLOBs are read whole). */
export type OracleValue<T extends OracleType> = T extends 'string' | 'clob'
    ? string
    : T extends 'number'
      ? number
      : T extends 'date' | 'timestamp'
        ? Date
        : T extends 'blob' | 'raw'
          ? Buffer
          : T extends 'boolean'
            ? boolean
            : never;

/** The `outBinds` of an execute(), typed from its binds. */
export type OutBinds<B> = B extends readonly unknown[]
    ? unknown[]
    : {
          [K in keyof B as B[K] extends { dir: 'out' | 'inout' | 'returning' } ? K : never]: B[K] extends {
              dir: 'returning';
              type: infer T extends OracleType;
          }
              ? (OracleValue<T> | null)[]
              : B[K] extends { type: infer T extends OracleType }
                ? OracleValue<T> | null
                : never;
      };

const DB_TYPES = {
    string: 'DB_TYPE_VARCHAR',
    number: 'DB_TYPE_NUMBER',
    date: 'DB_TYPE_DATE',
    timestamp: 'DB_TYPE_TIMESTAMP',
    clob: 'DB_TYPE_CLOB',
    blob: 'DB_TYPE_BLOB',
    raw: 'DB_TYPE_RAW',
    boolean: 'DB_TYPE_BOOLEAN',
} as const satisfies Record<OracleType, keyof OracledbModule>;

const DEFAULT_MAX_SIZE: Partial<Record<OracleType, number>> = { string: 4000, raw: 2000 };

function isBindSpec(value: unknown): value is OracleBindSpec {
    return (
        typeof value === 'object' &&
        value !== null &&
        !(value instanceof Date) &&
        !(value instanceof Uint8Array) &&
        ('type' in value || 'dir' in value)
    );
}

function translateOne(oracledb: OracledbModule, value: unknown, name: string): unknown {
    if (!isBindSpec(value)) return value;
    const dir = value.dir ?? 'in';
    if (!Object.hasOwn(DB_TYPES, value.type)) {
        throw new TypeError(`Bind "${name}": unknown Oracle type "${String(value.type)}"`);
    }
    const spec: Record<string, unknown> = { type: oracledb[DB_TYPES[value.type]] };
    switch (dir) {
        case 'in':
            spec.dir = oracledb.BIND_IN;
            spec.val = (value as OracleTypedBind).val;
            break;
        case 'inout':
            spec.dir = oracledb.BIND_INOUT;
            spec.val = (value as OracleInOutBind).val;
            break;
        case 'out':
        case 'returning':
            spec.dir = oracledb.BIND_OUT;
            break;
        default:
            throw new TypeError(`Bind "${name}": unknown direction "${String(dir)}"`);
    }
    const maxSize = value.maxSize ?? (dir === 'in' ? undefined : DEFAULT_MAX_SIZE[value.type]);
    if (maxSize !== undefined) spec.maxSize = maxSize;
    return spec;
}

/** Binds with type names translated to node-oracledb's bind definitions. */
export function toOracleBinds(oracledb: OracledbModule, binds: OracleBinds | undefined): unknown {
    if (binds === undefined) return [];
    if (Array.isArray(binds)) return binds.map((value, i) => translateOne(oracledb, value, String(i + 1)));
    return Object.fromEntries(
        Object.entries(binds as Record<string, unknown>).map(([name, value]) => [
            name,
            translateOne(oracledb, value, name),
        ]),
    );
}

type LobLike = { getData(): Promise<string | Buffer>; destroy?(): void };

function isLob(value: unknown): value is LobLike {
    return typeof value === 'object' && value !== null && typeof (value as LobLike).getData === 'function';
}

async function readLob(value: unknown): Promise<unknown> {
    if (Array.isArray(value)) return Promise.all(value.map(readLob));
    if (!isLob(value)) return value;
    try {
        return await value.getData();
    } finally {
        value.destroy?.();
    }
}

/** Out binds with CLOB and BLOB values read whole, so no Lob outlives the call. */
export async function readOutBinds(outBinds: unknown): Promise<unknown> {
    if (outBinds === undefined || outBinds === null) return {};
    if (Array.isArray(outBinds)) return Promise.all(outBinds.map(readLob));
    const entries = await Promise.all(
        Object.entries(outBinds as Record<string, unknown>).map(async ([k, v]) => [k, await readLob(v)] as const),
    );
    return Object.fromEntries(entries);
}

/**
 * The per-statement `fetchTypeHandler`: CLOBs as strings and BLOBs as Buffers
 * (a Lob would outlive the pooled connection it must be read on), plus the
 * configured fetchAsString types. oracledb's global settings are left alone.
 *
 * It must stay the same for every statement on the driver's connections:
 * Thin mode fixes a LOB column's fetch type on a query's first run and keeps
 * it with the cached statement, so a per-query override would be ignored
 * whenever the same SQL ran before on that connection.
 */
export function fetchTypeHandler(
    oracledb: OracledbModule,
    asString: ReadonlySet<OracleFetchAsString>,
): (metadata: { dbType?: unknown }) => { type: unknown } | undefined {
    const toString = new Set<unknown>([oracledb.DB_TYPE_CLOB, oracledb.DB_TYPE_NCLOB]);
    if (asString.has('number')) toString.add(oracledb.DB_TYPE_NUMBER);
    if (asString.has('date')) {
        for (const t of [
            oracledb.DB_TYPE_DATE,
            oracledb.DB_TYPE_TIMESTAMP,
            oracledb.DB_TYPE_TIMESTAMP_TZ,
            oracledb.DB_TYPE_TIMESTAMP_LTZ,
        ]) {
            toString.add(t);
        }
    }
    return ({ dbType }) => {
        if (toString.has(dbType)) return { type: oracledb.STRING };
        if (dbType === oracledb.DB_TYPE_BLOB) return { type: oracledb.BUFFER };
        return undefined;
    };
}
