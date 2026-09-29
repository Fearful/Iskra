import { QueryError } from './errors';

/**
 * A row could not be converted to what its spec or schema says. The column
 * is named; the value stays out of the message (it may be personal data).
 */
export class RowDecodeError extends QueryError {
    constructor(message: string) {
        super(message);
        this.name = 'RowDecodeError';
    }
}

/** How a column's value becomes the field's. */
export interface Column<T> {
    readonly kind: string;
    readonly isNullable: boolean;
    /** The column's name when it is not the field's (`ID_USUARIO` for `idUsuario` is found on its own). */
    readonly source?: string;
    decode(value: unknown, column: string): T;
    /** The field's value when the column is missing and `missing: 'zero'`. */
    readonly zero: T;
    /** Accepts NULL (the field is null) instead of failing. */
    nullable(): Column<T | null>;
    /** Reads the field from another column. */
    from(column: string): Column<T>;
}

function column<T>(kind: string, zero: T, decode: (value: unknown, column: string) => T): Column<T> {
    const make = <U>(isNullable: boolean, source: string | undefined, z: U): Column<U> => ({
        kind,
        isNullable,
        source,
        zero: z,
        decode: decode as unknown as (value: unknown, column: string) => U,
        nullable: () => make<U | null>(true, source, null),
        from: (name) => make<U>(isNullable, name, z),
    });
    return make<T>(false, undefined, zero);
}

const fail = (column: string, kind: string, value: unknown): never => {
    throw new RowDecodeError(`Column ${column}: a ${typeof value} is not a valid ${kind}`);
};

/** A number as plain decimal text, without the exponent JS uses past 1e21 or below 1e-6. */
export function plainDecimal(n: number): string {
    const text = String(n);
    const m = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(text);
    if (!m) return text;
    const [, sign, int, frac = '', exp] = m;
    const digits = int! + frac;
    const point = 1 + Number(exp);
    if (point <= 0) return `${sign}0.${'0'.repeat(-point)}${digits}`;
    if (point >= digits.length) return `${sign}${digits}${'0'.repeat(point - digits.length)}`;
    return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

const INTEGER = /^[+-]?\d+$/;

/**
 * Column types. Oracle returns NUMBER as a JS number, or as text with
 * `fetchAsString: ['number']` (exact past 2^53); these accept both.
 */
export const col = {
    /** An integer within JS's safe range (use `bigint()` past 2^53). `'12'` and `12` both work. */
    int: () =>
        column<number>('integer', 0, (value, name) => {
            const text =
                typeof value === 'number' ? plainDecimal(value) : typeof value === 'bigint' ? String(value) : value;
            if (typeof text !== 'string' || !INTEGER.test(text)) return fail(name, 'integer', value);
            const n = Number(text);
            if (!Number.isSafeInteger(n)) {
                throw new RowDecodeError(`Column ${name}: the integer is past 2^53; use col.bigint()`);
            }
            return n;
        }),
    /** An integer of any size, as a bigint. */
    bigint: () =>
        column<bigint>('integer', 0n, (value, name) => {
            const text =
                typeof value === 'number' ? plainDecimal(value) : typeof value === 'bigint' ? String(value) : value;
            if (typeof text !== 'string' || !INTEGER.test(text)) return fail(name, 'integer', value);
            return BigInt(text);
        }),
    /** A number (a decimal NUMBER). */
    number: () =>
        column<number>('number', 0, (value, name) => {
            const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
            if (typeof n !== 'number' || !Number.isFinite(n)) return fail(name, 'number', value);
            return n;
        }),
    /** Text: a NUMBER as plain decimal text, a DATE as ISO 8601. */
    string: () =>
        column<string>('string', '', (value, name) => {
            if (typeof value === 'string') return value;
            if (typeof value === 'number') return plainDecimal(value);
            if (typeof value === 'bigint') return String(value);
            if (value instanceof Date) return value.toISOString();
            return fail(name, 'string', value);
        }),
    /** A flag: 1/0, S/N, Y/N, T/F, true/false (a CHAR(1) or NUMBER(1)). */
    boolean: () =>
        column<boolean>('boolean', false, (value, name) => {
            if (typeof value === 'boolean') return value;
            const text = String(value).trim().toUpperCase();
            if (['1', 'S', 'Y', 'T', 'TRUE'].includes(text)) return true;
            if (['0', 'N', 'F', 'FALSE'].includes(text)) return false;
            return fail(name, 'boolean', value);
        }),
    /** A date: a DATE or TIMESTAMP, or text JS can parse. */
    date: () =>
        column<Date>('date', new Date(0), (value, name) => {
            const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : undefined;
            if (!date || Number.isNaN(date.getTime())) return fail(name, 'date', value);
            return date;
        }),
};

export interface RowSpecOptions {
    /** A column the spec does not name: left out (default), kept as it came, or an error. */
    extra?: 'ignore' | 'keep' | 'error';
    /** A field whose column is missing: left out (default), its type's zero (Go's), or an error. */
    missing?: 'undefined' | 'zero' | 'error';
}

type Decoded<S extends Record<string, Column<unknown>>> = { [K in keyof S]: S[K] extends Column<infer T> ? T : never };

/** Turns a raw row into a typed one. */
export interface RowDecoder<T> {
    decode(row: Record<string, unknown>): T | Promise<T>;
}

/** `camelCase` → `CAMEL_CASE`, how Oracle names the column of a camelCase field. */
const upperSnake = (field: string) => field.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();

/**
 * A row spec: each field and its column type. The column of a field is
 * `from()`'s, else the field's name ignoring case, else its UPPER_SNAKE_CASE
 * (`idUsuario` reads `ID_USUARIO`). NULL fails a field that is not
 * `nullable()`.
 *
 * ```ts
 * const Usuario = rowSpec({ id: col.int(), nombre: col.string(), activo: col.boolean(), baja: col.date().nullable() });
 * const usuarios = await oracle.query('SELECT id, nombre, activo, baja FROM usuarios', {}, { rows: Usuario });
 * ```
 */
export function rowSpec<S extends Record<string, Column<unknown>>>(
    spec: S,
    options: RowSpecOptions = {},
): RowDecoder<Decoded<S>> {
    const fields = Object.entries(spec);
    return {
        decode(row) {
            const byUpper = new Map(Object.keys(row).map((key) => [key.toUpperCase(), key]));
            const used = new Set<string>();
            const out: Record<string, unknown> = {};
            for (const [field, type] of fields) {
                const key = byUpper.get((type.source ?? field).toUpperCase()) ?? byUpper.get(upperSnake(field));
                if (key === undefined) {
                    if (options.missing === 'error') throw new RowDecodeError(`Column for ${field} is missing`);
                    if (options.missing === 'zero') out[field] = type.zero;
                    continue;
                }
                used.add(key);
                const value = row[key];
                if (value === null || value === undefined) {
                    if (!type.isNullable)
                        throw new RowDecodeError(`Column ${key} is NULL; declare ${field} nullable()`);
                    out[field] = null;
                } else {
                    out[field] = type.decode(value, key);
                }
            }
            if (options.extra && options.extra !== 'ignore') {
                for (const key of Object.keys(row)) {
                    if (used.has(key)) continue;
                    if (options.extra === 'error') throw new RowDecodeError(`Column ${key} has no field in the spec`);
                    out[key] = row[key];
                }
            }
            return out as Decoded<S>;
        },
    };
}

/** A Standard Schema (Zod 3.24+, Valibot, ArkType…): `~standard.validate`. */
export interface StandardSchemaLike<T> {
    readonly '~standard': {
        validate(
            value: unknown,
        ):
            | { value: T; issues?: undefined }
            | { issues: ReadonlyArray<{ message: string; path?: ReadonlyArray<unknown> }> }
            | Promise<
                  | { value: T; issues?: undefined }
                  | { issues: ReadonlyArray<{ message: string; path?: ReadonlyArray<unknown> }> }
              >;
    };
}

/** How a statement's rows are decoded: a row spec, or any Standard Schema. */
export type RowsOption<T> = RowDecoder<T> | StandardSchemaLike<T>;

function isStandard<T>(rows: RowsOption<T>): rows is StandardSchemaLike<T> {
    return typeof (rows as Partial<StandardSchemaLike<T>>)['~standard']?.validate === 'function';
}

/** Decodes each row with a row spec or a Standard Schema. */
export async function decodeRows<T>(rows: readonly unknown[], decoder: RowsOption<T>): Promise<T[]> {
    const out: T[] = [];
    for (const row of rows) {
        if (!isStandard(decoder)) {
            out.push(await decoder.decode(row as Record<string, unknown>));
            continue;
        }
        const result = await decoder['~standard'].validate(row);
        if (result.issues) {
            const fields = result.issues.map((issue) => (issue.path ?? []).map(String).join('.') || '(row)');
            throw new RowDecodeError(`Row does not match the schema at ${[...new Set(fields)].join(', ')}`);
        }
        out.push(result.value);
    }
    return out;
}
