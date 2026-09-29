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

/**
 * Oracle's reserved words (SQL Language Reference, appendix D): a bind with
 * one of these names fails with ORA-01745 ("invalid host/bind variable name").
 */
const RESERVED = new Set(
    (
        'ACCESS ADD ALL ALTER AND ANY AS ASC AUDIT BETWEEN BY CHAR CHECK CLUSTER COLUMN COLUMN_VALUE COMMENT ' +
        'COMPRESS CONNECT CREATE CURRENT DATE DECIMAL DEFAULT DELETE DESC DISTINCT DROP ELSE EXCLUSIVE EXISTS ' +
        'FILE FLOAT FOR FROM GRANT GROUP HAVING IDENTIFIED IMMEDIATE IN INCREMENT INDEX INITIAL INSERT INTEGER ' +
        'INTERSECT INTO IS LEVEL LIKE LOCK LONG MAXEXTENTS MINUS MLSLABEL MODE MODIFY NESTED_TABLE_ID NOAUDIT ' +
        'NOCOMPRESS NOT NOWAIT NULL NUMBER OF OFFLINE ON ONLINE OPTION OR ORDER PCTFREE PRIOR PUBLIC RAW RENAME ' +
        'RESOURCE REVOKE ROW ROWID ROWNUM ROWS SELECT SESSION SET SHARE SIZE SMALLINT START SUCCESSFUL SYNONYM ' +
        'SYSDATE TABLE THEN TO TRIGGER UID UNION UNIQUE UPDATE USER VALIDATE VALUES VARCHAR VARCHAR2 VIEW ' +
        'WHENEVER WHERE WITH'
    ).split(' '),
);

const Q_QUOTE_CLOSE: Record<string, string> = { '[': ']', '{': '}', '(': ')', '<': '>' };

/**
 * The bind placeholders of a statement, upper-cased (`:name`, `:1`,
 * `:"Quoted"` kept as written), skipping string literals (q-quotes too),
 * quoted identifiers, comments and PL/SQL's `:=`.
 */
export function sqlBindNames(sql: string): Set<string> {
    const names = new Set<string>();
    let i = 0;
    while (i < sql.length) {
        const c = sql[i]!;
        if ((c === 'q' || c === 'Q') && sql[i + 1] === "'" && i + 2 < sql.length) {
            const open = sql[i + 2]!;
            const close = `${Q_QUOTE_CLOSE[open] ?? open}'`;
            const end = sql.indexOf(close, i + 3);
            i = end === -1 ? sql.length : end + 2;
        } else if (c === "'") {
            i++;
            while (i < sql.length && !(sql[i] === "'" && sql[i + 1] !== "'")) i += sql[i] === "'" ? 2 : 1;
            i++;
        } else if (c === '"') {
            const end = sql.indexOf('"', i + 1);
            i = end === -1 ? sql.length : end + 1;
        } else if (sql.startsWith('--', i)) {
            const end = sql.indexOf('\n', i);
            i = end === -1 ? sql.length : end + 1;
        } else if (sql.startsWith('/*', i)) {
            const end = sql.indexOf('*/', i + 2);
            i = end === -1 ? sql.length : end + 2;
        } else if (c === ':' && sql[i + 1] === '"') {
            const end = sql.indexOf('"', i + 2);
            if (end === -1) break;
            names.add(sql.slice(i + 2, end));
            i = end + 1;
        } else if (c === ':' && /[A-Za-z0-9_$#]/.test(sql[i + 1] ?? '')) {
            const match = /^[A-Za-z0-9_$#]+/.exec(sql.slice(i + 1))!;
            names.add(match[0].toUpperCase());
            i += 1 + match[0].length;
        } else {
            i++;
        }
    }
    return names;
}

/** Refuses binds by name that Oracle would reject or confuse: reserved words, and two names differing only in case. */
function checkBindNames(names: readonly string[]) {
    const seen = new Map<string, string>();
    for (const name of names) {
        const upper = name.toUpperCase();
        if (RESERVED.has(upper)) {
            throw new TypeError(`Bind "${name}": ${upper} is an Oracle reserved word (ORA-01745); rename it`);
        }
        const other = seen.get(upper);
        if (other !== undefined) {
            throw new TypeError(`Binds "${other}" and "${name}" differ only in case: Oracle bind names ignore case`);
        }
        seen.set(upper, name);
    }
}

export interface BindOptions {
    /** The statement, to leave out the binds by name it does not use (with `dropUnused`). */
    sql?: string;
    dropUnused?: boolean;
}

/**
 * Binds with type names translated to node-oracledb's bind definitions. Binds
 * by name are checked (see checkBindNames) and, with `dropUnused`, those the
 * SQL does not use are left out. Binds by position go in the order their
 * placeholders appear in the SQL, whatever their numbers.
 */
export function toOracleBinds(
    oracledb: OracledbModule,
    binds: OracleBinds | undefined,
    options: BindOptions = {},
): unknown {
    if (binds === undefined) return [];
    if (Array.isArray(binds)) return binds.map((value, i) => translateOne(oracledb, value, String(i + 1)));
    let entries = Object.entries(binds as Record<string, unknown>);
    checkBindNames(entries.map(([name]) => name));
    if (options.dropUnused && options.sql !== undefined) {
        const used = sqlBindNames(options.sql);
        entries = entries.filter(([name]) => used.has(name.toUpperCase()) || used.has(name));
    }
    return Object.fromEntries(entries.map(([name, value]) => [name, translateOne(oracledb, value, name)]));
}

/** The type (and direction) of one bind of executeMany(), for every row. */
export interface OracleBindDef {
    type: OracleType;
    dir?: 'in' | 'out' | 'inout' | 'returning';
    /** Bytes; for `string` and `raw` it defaults to the longest value in the rows. */
    maxSize?: number;
}

function inferDef(values: unknown[]): OracleBindDef {
    const sample = values.find((v) => v !== null && v !== undefined);
    if (typeof sample === 'number' || typeof sample === 'bigint') return { type: 'number' };
    if (typeof sample === 'boolean') return { type: 'boolean' };
    if (sample instanceof Date) return { type: 'timestamp' };
    if (sample instanceof Uint8Array) return { type: 'raw' };
    return { type: 'string' };
}

/** The longest value of a string or RAW bind across the rows, in bytes (at least 1). */
function sizeOf(values: unknown[]): number {
    let max = 1;
    for (const v of values) {
        const size =
            typeof v === 'string'
                ? Buffer.byteLength(v)
                : v instanceof Uint8Array
                  ? v.length
                  : v === null || v === undefined
                    ? 0
                    : Buffer.byteLength(String(v));
        if (size > max) max = size;
    }
    return max;
}

/**
 * The rows and bindDefs of an executeMany(). Plain rows go as they are
 * (node-oracledb infers their types). Once a type is named, in `defs` or as
 * `{ type, val }` in the first row, every bind needs a definition: the others
 * are inferred from the rows, and strings and RAW get the longest value's
 * size. OUT and RETURNING binds come from `defs` and are not in the rows.
 */
export function toExecuteMany(
    oracledb: OracledbModule,
    rows: readonly OracleBinds[],
    defs?: Readonly<Record<string, OracleBindDef>> | readonly OracleBindDef[],
): { rows: unknown[]; bindDefs?: unknown } {
    const positional = Array.isArray(rows[0]);
    const keysOf = (row: OracleBinds) =>
        Array.isArray(row) ? row.map((_, i) => String(i)) : Object.keys(row as Record<string, unknown>);
    const valueOf = (row: OracleBinds, key: string) =>
        Array.isArray(row) ? row[Number(key)] : (row as Record<string, unknown>)[key];
    const keys = [...new Set([...rows.flatMap(keysOf), ...(defs ? Object.keys(defs) : [])])];
    const first = rows[0];
    const specInRows = first !== undefined && keys.some((k) => isBindSpec(valueOf(first, k)));
    if (!defs && !specInRows) return { rows: [...rows] };
    if (!positional) checkBindNames(keys);

    const resolved = new Map<string, OracleBindDef>();
    for (const key of keys) {
        const given = defs ? (defs as Record<string, OracleBindDef>)[key] : undefined;
        const spec = first !== undefined ? valueOf(first, key) : undefined;
        const values = rows.map((row) => {
            const v = valueOf(row, key);
            return isBindSpec(v) ? (v as { val?: unknown }).val : v;
        });
        const def: OracleBindDef = given ?? (isBindSpec(spec) ? { ...spec } : inferDef(values));
        const dir = def.dir ?? 'in';
        const maxSize =
            def.maxSize ??
            (def.type === 'string' || def.type === 'raw'
                ? dir === 'in' || dir === 'inout'
                    ? sizeOf(values)
                    : DEFAULT_MAX_SIZE[def.type]
                : undefined);
        resolved.set(key, { type: def.type, dir, ...(maxSize !== undefined ? { maxSize } : {}) });
    }

    const toDef = ([key, def]: [string, OracleBindDef]) => {
        const out = translateOne(oracledb, { ...def, val: undefined } as OracleBindSpec, key) as Record<
            string,
            unknown
        >;
        delete out.val;
        return out;
    };
    const inKeys = keys.filter((k) => ['in', 'inout'].includes(resolved.get(k)!.dir ?? 'in'));
    const unwrapped = rows.map((row) => {
        if (positional) {
            return keys.map((k) => {
                const v = valueOf(row, k);
                return isBindSpec(v) ? (v as { val?: unknown }).val : v;
            });
        }
        return Object.fromEntries(
            inKeys.map((k) => {
                const v = valueOf(row, k);
                return [k, isBindSpec(v) ? (v as { val?: unknown }).val : (v ?? null)];
            }),
        );
    });
    const bindDefs = positional
        ? keys.map((k) => toDef([k, resolved.get(k)!]))
        : Object.fromEntries(keys.map((k) => [k, toDef([k, resolved.get(k)!])]));
    return { rows: unwrapped, bindDefs };
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
