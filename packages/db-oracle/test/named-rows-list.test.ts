import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { compileNamed } from '../src/named';
import { col, decodeRows, plainDecimal, rowSpec, RowDecodeError } from '../src/rows';
import { NoRowsError, QueryInputError } from '../src/errors';
import { CONFIG, startedDriver } from './fakes';

describe("compileNamed(), Oracle's dialect", () => {
    test('numbers the placeholders, repeats a name used twice, leaves unused params out, ignores case', () => {
        const compiled = compileNamed('SELECT * FROM t WHERE a = :Id OR b = :id AND c = :date', {
            id: 7,
            DATE: '2024-01-01',
            unused: 1,
        });
        expect(compiled.sql).toBe('SELECT * FROM t WHERE a = :1 OR b = :2 AND c = :3');
        expect(compiled.binds).toEqual([7, 7, '2024-01-01']);
        expect(compiled.names).toEqual(['id', 'id', 'DATE']);
    });

    test('expands an array into an IN list, and refuses an empty one or a missing name', () => {
        expect(compileNamed('SELECT * FROM t WHERE id IN (:ids)', { ids: [1, 2, 3] })).toMatchObject({
            sql: 'SELECT * FROM t WHERE id IN (:1, :2, :3)',
            binds: [1, 2, 3],
        });
        expect(() => compileNamed('WHERE id IN (:ids)', { ids: [] })).toThrow('empty list');
        expect(() => compileNamed('WHERE id = :id', {})).toThrow('Bind :id has no value');
    });

    test('skips literals, q-quotes, quoted identifiers, comments and :=', () => {
        const sql = `SELECT ':no', q'[:no]', "A:NO", x -- :no
            /* :no */ FROM t WHERE y = :yes; BEGIN v := 1; END;`;
        const compiled = compileNamed(sql, { yes: 1 });
        expect(compiled.binds).toEqual([1]);
        expect(compiled.sql).toContain(`':no', q'[:no]', "A:NO"`);
        expect(compiled.sql).toContain('y = :1');
        expect(compiled.sql).toContain('v := 1');
    });
});

describe("compileNamed(), sqlx's dialect", () => {
    test('reads :: as a literal colon, rebinds to :argN and expands IN', () => {
        const compiled = compileNamed(
            "SELECT TO_CHAR(f, 'HH24::MI') FROM t WHERE id IN (:ids) AND u = :user_id",
            { ids: [1, 2], user_id: 'ana', extra: true },
            'sqlx',
        );
        expect(compiled.sql).toBe("SELECT TO_CHAR(f, 'HH24:MI') FROM t WHERE id IN (:arg1, :arg2) AND u = :arg3");
        expect(compiled.binds).toEqual([1, 2, 'ana']);
    });

    test('matches names exactly, and keeps its quirks: a name at the end, := and ? inside literals', () => {
        expect(() => compileNamed('WHERE id = :ID', { id: 1 }, 'sqlx')).toThrow('could not find name ID in map');
        expect(compileNamed('WHERE id = :id', { id: 1 }, 'sqlx').sql).toBe('WHERE id = :arg1');
        expect(compileNamed('BEGIN x := :v; END;', { v: 1 }, 'sqlx').sql).toBe('BEGIN x := :arg1; END;');
        expect(compileNamed("WHERE a = '?' AND b = :b", { b: 2 }, 'sqlx').sql).toBe("WHERE a = ':arg1' AND b = :arg2");
    });
});

describe('row specs', () => {
    const Usuario = rowSpec({
        id: col.int(),
        nombre: col.string(),
        activo: col.boolean(),
        saldo: col.number(),
        legajo: col.bigint().nullable(),
        idArea: col.int(),
        baja: col.date().nullable(),
    });

    test('converts each column to its field, UPPER_SNAKE columns included', async () => {
        const [row] = await decodeRows(
            [
                {
                    ID: '12',
                    NOMBRE: 'Ana',
                    ACTIVO: 'S',
                    SALDO: '10.5',
                    LEGAJO: '9007199254740993',
                    ID_AREA: 3,
                    BAJA: null,
                    EXTRA: 'dropped',
                },
            ],
            Usuario,
        );
        expect(row).toEqual({
            id: 12,
            nombre: 'Ana',
            activo: true,
            saldo: 10.5,
            legajo: 9007199254740993n,
            idArea: 3,
            baja: null,
        });
    });

    test('refuses NULL in a field that is not nullable, and bad values, naming the column but not the value', async () => {
        const base = { ID: 1, NOMBRE: 'x', ACTIVO: 1, SALDO: 0, ID_AREA: 1 };
        await expect(decodeRows([{ ...base, NOMBRE: null }], Usuario)).rejects.toThrow('Column NOMBRE is NULL');
        const error = (await decodeRows([{ ...base, ID: 'doce' }], Usuario).catch((e: unknown) => e)) as Error;
        expect(error).toBeInstanceOf(RowDecodeError);
        expect(error.message).toContain('Column ID');
        expect(error.message).not.toContain('doce');
        await expect(decodeRows([{ ...base, ID: '9007199254740993' }], Usuario)).rejects.toThrow('use col.bigint()');
    });

    test("extra and missing columns, as Go's sqlx or leniently", async () => {
        const strict = rowSpec({ id: col.int(), nombre: col.string() }, { extra: 'error', missing: 'zero' });
        await expect(decodeRows([{ ID: 1, NOMBRE: 'a', OTRA: 1 }], strict)).rejects.toThrow('Column OTRA has no field');
        expect(await decodeRows([{ ID: 1 }], strict)).toEqual([{ id: 1, nombre: '' }]);
        const keep = rowSpec({ id: col.int() }, { extra: 'keep', missing: 'error' });
        // Kept columns are not in the spec's type.
        expect((await decodeRows([{ ID: 1, OTRA: 2 }], keep)) as unknown[]).toEqual([{ id: 1, OTRA: 2 }]);
        await expect(decodeRows([{}], keep)).rejects.toThrow('Column for id is missing');
    });

    test('writes a NUMBER as plain decimal text', () => {
        expect(plainDecimal(1e21)).toBe('1000000000000000000000');
        expect(plainDecimal(1.5e-7)).toBe('0.00000015');
        expect(plainDecimal(12.5)).toBe('12.5');
        expect(col.string().decode(1e21, 'X')).toBe('1000000000000000000000');
    });

    test('takes a Standard Schema too', async () => {
        const schema = z.object({ ID: z.coerce.number(), NOMBRE: z.string() });
        expect(await decodeRows([{ ID: '3', NOMBRE: 'a' }], schema)).toEqual([{ ID: 3, NOMBRE: 'a' }]);
        await expect(decodeRows([{ ID: 'x', NOMBRE: 1 }], schema)).rejects.toThrow('at ID, NOMBRE');
    });
});

describe('bindStyle: positional', () => {
    test('runs a statement with binds by position, and hands the hook the SQL as written', async () => {
        const { driver, pool } = await startedDriver({ ...CONFIG, bindStyle: 'positional' });
        const seen: string[] = [];
        driver.setOnQuery((sql) => void seen.push(sql));
        await driver.query('SELECT * FROM t WHERE id IN (:ids) AND owner = :user', { ids: [1, 2], user: 'ana', x: 0 });
        const call = pool.calls.at(-1)!;
        expect(call.sql).toBe('SELECT * FROM t WHERE id IN (:1, :2) AND owner = :3');
        expect(call.binds).toEqual([1, 2, 'ana']);
        expect(seen).toEqual(['SELECT * FROM t WHERE id IN (:ids) AND owner = :user']);
    });

    test('per call, with the sqlx dialect, and OUT binds back by name', async () => {
        const { driver, pool } = await startedDriver();
        pool.respond = () => ({ outBinds: [42] });
        const result = await driver.execute(
            'BEGIN alta(:nombre, :id); END;',
            { nombre: 'Ana', id: { dir: 'out', type: 'number' } },
            { bindStyle: 'positional', bindDialect: 'sqlx' },
        );
        expect(pool.calls.at(-1)!.sql).toBe('BEGIN alta(:arg1, :arg2); END;');
        expect(result.outBinds).toEqual({ id: 42 });
    });
});

describe('one() and list()', () => {
    test('one() throws NoRowsError without a row, and decodes the row it finds', async () => {
        const { driver, pool } = await startedDriver();
        pool.respond = () => ({ rows: [] });
        await expect(driver.one('SELECT * FROM t WHERE id = :id', { id: 1 })).rejects.toBeInstanceOf(NoRowsError);
        pool.respond = () => ({ rows: [{ ID: '5' }] });
        expect(await driver.one('SELECT id FROM t', {}, { rows: rowSpec({ id: col.int() }) })).toEqual({ id: 5 });
    });

    test('list() pages a query built from filters, counting with and without them', async () => {
        const { driver, pool } = await startedDriver({ ...CONFIG, bindStyle: 'positional' });
        pool.respond = (call) => {
            if (!call.sql.includes('ISKRA_TOTAL')) return { rows: [{ ID: 1 }, { ID: 2 }] };
            return { rows: [{ ISKRA_TOTAL: call.sql.includes('estado') ? '12' : 40 }] };
        };
        const query = (filters: { estado?: string }, orders: string | null) => ({
            sql: `SELECT id FROM usuarios${filters.estado ? ' WHERE estado = :estado' : ''}${orders ? ` ORDER BY ${orders}` : ''}`,
            params: { estado: filters.estado },
        });

        const page = await driver.list({
            query,
            filters: { estado: 'A' },
            orders: 'id',
            totalFilters: {},
            offset: '10',
            limit: '5',
            rows: rowSpec({ id: col.int() }),
        });
        expect(page).toEqual({ rows: [{ id: 1 }, { id: 2 }], total: 40, filtered: 12, offset: 10, limit: 5, pages: 3 });

        const [rowsCall, ...counts] = pool.statements.slice(-3).map((sql) => sql);
        expect(rowsCall).toBe(
            'SELECT id FROM usuarios WHERE estado = :1 ORDER BY id\nOFFSET :2 ROWS FETCH NEXT :3 ROWS ONLY',
        );
        expect(counts).toEqual([
            'SELECT COUNT(*) AS "ISKRA_TOTAL" FROM (\nSELECT id FROM usuarios WHERE estado = :1\n) iskra_count',
            'SELECT COUNT(*) AS "ISKRA_TOTAL" FROM (\nSELECT id FROM usuarios\n) iskra_count',
        ]);
    });

    test('list() of plain SQL: page and pageSize, every row with limit -1, and bad input from the request', async () => {
        const { driver, pool } = await startedDriver({ ...CONFIG, bindStyle: 'positional' });
        pool.respond = (call) => (call.sql.includes('ISKRA_TOTAL') ? { rows: [{ ISKRA_TOTAL: 7 }] } : { rows: [] });

        expect(await driver.list({ sql: 'SELECT * FROM t ORDER BY id', page: '2', pageSize: '3' })).toMatchObject({
            offset: 3,
            limit: 3,
            page: 2,
            pageSize: 3,
            total: 7,
            filtered: 7,
            pages: 3,
        });
        const all = await driver.list({ sql: 'SELECT * FROM t ORDER BY id', limit: -1, count: 'none' });
        expect(all).toEqual({ rows: [], offset: null, limit: null });
        expect(pool.statements.at(-1)).toBe('SELECT * FROM t ORDER BY id');

        await expect(driver.list({ sql: 'SELECT 1 FROM dual', offset: 'x', limit: 5 })).rejects.toBeInstanceOf(
            QueryInputError,
        );
        expect((await driver.list({ sql: 'SELECT 1 FROM dual', limit: -1, maxLimit: 100, count: 'none' })).limit).toBe(
            100,
        );
    });

    test('a transaction lists and finds on its own connection', async () => {
        const { driver, pool } = await startedDriver();
        pool.respond = (call) =>
            call.sql.includes('ISKRA_TOTAL') ? { rows: [{ ISKRA_TOTAL: 1 }] } : { rows: [{ ID: 1 }] };
        await driver.transaction(async (tx) => {
            await tx.list({ sql: 'SELECT id FROM t ORDER BY id', limit: 10 });
            await tx.one('SELECT id FROM t WHERE id = 1');
        });
        const connection = pool.connections.at(-1)!;
        expect(pool.calls.filter((c) => c.connection === connection)).toHaveLength(3);
        expect(connection.commits).toBe(1);
    });
});
