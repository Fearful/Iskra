import { describe, expect, test } from 'bun:test';
import oracledb from 'oracledb';
import { sqlBindNames, toOracleBinds } from '../src/binds';
import type { QueryEnd } from '../src/driver';
import { QueryError } from '../src/errors';
import { CONFIG, oraError, startedDriver } from './fakes';

/** An Error shaped like node-oracledb's own (NJS-…). */
function njsError(num: number, message: string): Error {
    return Object.assign(new Error(`NJS-${String(num).padStart(3, '0')}: ${message}`), {
        code: `NJS-${String(num).padStart(3, '0')}`,
    });
}

describe('timeouts and cancellation', () => {
    test('every statement runs with callTimeout (default 30 s), a per-call timeout overrides it', async () => {
        const { driver, pool } = await startedDriver();
        await driver.query('SELECT 1 FROM DUAL');
        await driver.query('SELECT 2 FROM DUAL', [], { timeout: 500 });
        await driver.query('SELECT 3 FROM DUAL', [], { timeout: 0 });
        const connections = pool.connections.slice(1);
        expect(connections.map((c) => c.timeouts.at(-1))).toEqual([30_000, 500, 0]);
        // The connection goes back to the pool with the configured timeout.
        expect(connections.every((c) => c.callTimeout === 30_000)).toBe(true);
    });

    test('callTimeout comes from the config', async () => {
        const { driver, pool } = await startedDriver({ ...CONFIG, callTimeout: 1234 });
        await driver.execute('UPDATE t SET x = 1');
        expect(pool.connections.at(-1)!.timeouts).toEqual([1234]);
    });

    test('a timed out statement is a QueryError NJS-123 and its connection is dropped from the pool', async () => {
        const { driver, pool } = await startedDriver();
        pool.respond = () => njsError(123, 'call timeout of 30000 ms exceeded');
        const error = (await driver.execute('UPDATE t SET x = 1').catch((e: unknown) => e)) as QueryError;
        expect(error).toBeInstanceOf(QueryError);
        expect(error.errorCode).toBe('NJS-123');
        expect(pool.connections.at(-1)!.dropped).toBe(true);

        pool.respond = () => oraError(1, 'unique constraint violated');
        await driver.execute('INSERT …').catch(() => {});
        expect(pool.connections.at(-1)!.dropped).toBe(false);
    });

    test('an AbortSignal cancels the running statement; an aborted one does not run', async () => {
        const { driver, pool } = await startedDriver();
        const controller = new AbortController();
        let release!: () => void;
        pool.respond = () =>
            new Promise((resolve) => {
                release = () => resolve(oraError(1013, 'user requested cancel of current operation'));
            });
        const running = driver.query('SELECT slow FROM t', [], { signal: controller.signal }).catch((e: unknown) => e);
        await Bun.sleep(5);
        controller.abort();
        release();
        const error = (await running) as QueryError;
        expect(pool.connections.at(-1)!.breaks).toBe(1);
        expect(error.errorCode).toBe('ORA-01013');

        const calls = pool.calls.length;
        await expect(driver.query('SELECT 1 FROM DUAL', [], { signal: controller.signal })).rejects.toThrow(
            'aborted before it ran',
        );
        expect(pool.calls.length).toBe(calls);
    });

    test('a Kysely query takes an AbortSignal too', async () => {
        const { driver, pool } = await startedDriver<{ T: { X: number } }>();
        const controller = new AbortController();
        controller.abort();
        await expect(driver.db!.selectFrom('T').selectAll().execute({ signal: controller.signal })).rejects.toThrow();
        expect(pool.statements).toEqual([]);
    });

    test('ping() answers false within pingTimeout when no connection is free, and shares one wait', async () => {
        const { driver, pool } = await startedDriver({ ...CONFIG, pingTimeout: 30 });
        let waiting = 0;
        pool.waitForConnection = () => {
            waiting++;
            return new Promise(() => {});
        };
        const started = performance.now();
        expect(await Promise.all([driver.ping(), driver.ping()])).toEqual([false, false]);
        expect(performance.now() - started).toBeLessThan(1000);
        expect(waiting).toBe(1);
    });

    test('ping() runs SELECT 1 with pingTimeout as the call timeout', async () => {
        const { driver, pool } = await startedDriver({ ...CONFIG, pingTimeout: 700 });
        expect(await driver.ping()).toBe(true);
        expect(pool.connections.at(-1)!.timeouts).toEqual([700]);
    });
});

describe('observability, errors, queryOne', () => {
    test('the OnQuery hook may return a function called with the duration, counts or error', async () => {
        const { driver, pool } = await startedDriver();
        const ends: [string, QueryEnd][] = [];
        driver.setOnQuery((sql) => (end: QueryEnd) => ends.push([sql, end]));

        pool.respond = () => ({ rows: [{ A: 1 }, { A: 2 }] });
        await driver.query('SELECT a FROM t');
        pool.respond = () => ({ rowsAffected: 3 });
        await driver.execute('UPDATE t SET a = 1');
        await driver.executeMany('INSERT INTO t (a) VALUES (:a)', [{ a: 1 }, { a: 2 }, { a: 3 }]);
        pool.respond = () => oraError(942, 'table or view does not exist');
        await driver.query('SELECT * FROM nope').catch(() => {});

        expect(ends.map(([sql, e]) => [sql, e.rows, e.rowsAffected, e.error?.errorCode])).toEqual([
            ['SELECT a FROM t', 2, undefined, undefined],
            ['UPDATE t SET a = 1', undefined, 3, undefined],
            ['INSERT INTO t (a) VALUES (:a)', undefined, 3, undefined],
            ['SELECT * FROM nope', undefined, undefined, 'ORA-00942'],
        ]);
        expect(ends.every(([, e]) => e.durationMs >= 0)).toBe(true);
    });

    test('a stream calls the hook once, and its end with all the rows it yielded', async () => {
        const { driver, pool } = await startedDriver();
        const chunks = [[{ N: 1 }, { N: 2 }], [{ N: 3 }], []];
        pool.respond = () => ({ resultSet: { getRows: async () => chunks.shift()!, close: async () => {} } });
        const starts: string[] = [];
        const ends: QueryEnd[] = [];
        driver.setOnQuery((sql) => {
            starts.push(sql);
            return (end: QueryEnd) => ends.push(end);
        });
        for await (const row of driver.stream('SELECT n FROM t', [], { chunkSize: 2 })) void row;
        expect(starts).toEqual(['SELECT n FROM t']);
        expect(ends).toHaveLength(1);
        expect(ends[0]!.rows).toBe(3);
    });

    test('a throwing hook or end function never fails the statement', async () => {
        const { driver } = await startedDriver();
        driver.setOnQuery(() => () => {
            throw new Error('end failure');
        });
        await driver.query('SELECT 1 FROM DUAL');
    });

    test('a pool with no free connection is a QueryError NJS-040 (a 503)', async () => {
        const { driver, pool } = await startedDriver();
        pool.waitForConnection = async () => {
            throw njsError(40, 'connection request timeout. Request exceeded "queueTimeout" of 60000');
        };
        const error = (await driver.query('SELECT 1 FROM DUAL').catch((e: unknown) => e)) as QueryError;
        expect(error).toBeInstanceOf(QueryError);
        expect(error.errorCode).toBe('NJS-040');
        expect(error.errorNum).toBeUndefined();
    });

    test('queryOne() fetches one row', async () => {
        const { driver, pool } = await startedDriver();
        pool.respond = () => ({ rows: [{ ID: 7 }] });
        expect(await driver.queryOne<{ ID: number }>('SELECT id FROM t ORDER BY id')).toEqual({ ID: 7 });
        expect(pool.calls.at(-1)!.options.maxRows).toBe(1);
        pool.respond = () => ({ rows: [] });
        expect(await driver.queryOne('SELECT id FROM t WHERE 1 = 0')).toBeUndefined();
    });

    test('execute() reports a warning (PL/SQL created with compilation errors)', async () => {
        const { driver, pool } = await startedDriver();
        pool.respond = () => ({
            warning: { code: 'NJS-700', message: 'NJS-700: creation succeeded with compilation errors' },
        });
        const result = await driver.execute('CREATE OR REPLACE PROCEDURE p IS BEGIN nope; END;');
        expect(result.warning).toBe('NJS-700: creation succeeded with compilation errors');
    });
});

describe('binds', () => {
    test('sqlBindNames() finds placeholders outside strings, comments and :=', () => {
        const sql = `SELECT :id, :"Mixed", ':not_a_bind', q'[:nor_this]', "col:x" -- :comment
            FROM t /* :block */ WHERE a = :A AND b = :2;
            BEGIN :out := 1; END;`;
        expect([...sqlBindNames(sql)].sort()).toEqual(['2', 'A', 'ID', 'Mixed', 'OUT']);
    });

    test('rejects reserved words and names that differ only in case', () => {
        expect(() => toOracleBinds(oracledb, { uid: 1 })).toThrow('UID is an Oracle reserved word (ORA-01745)');
        expect(() => toOracleBinds(oracledb, { id: 1, ID: 2 })).toThrow('differ only in case');
        expect(toOracleBinds(oracledb, { userId: 1 })).toEqual({ userId: 1 });
    });

    test('dropUnusedBinds leaves out the binds the SQL does not use, from the config or per call', async () => {
        const { driver, pool } = await startedDriver();
        const binds = { id: 1, extra: 'x' };
        await driver.query('SELECT * FROM t WHERE id = :id', binds, { dropUnusedBinds: true });
        expect(pool.calls.at(-1)!.binds).toEqual({ id: 1 });
        await driver.query('SELECT * FROM t WHERE id = :id', binds);
        expect(pool.calls.at(-1)!.binds).toEqual(binds);

        const configured = await startedDriver({ ...CONFIG, dropUnusedBinds: true });
        await configured.driver.query('SELECT * FROM t WHERE ID = :ID', binds);
        expect(configured.pool.calls.at(-1)!.binds).toEqual({ id: 1 });
    });

    test('executeMany() with a typed bind: bindDefs for every bind, values unwrapped', async () => {
        const { driver, pool } = await startedDriver();
        pool.respond = () => ({ rowsAffected: 2, outBinds: [{ id: [1] }, { id: [2] }] }) as never;
        const long = 'x'.repeat(50_000);
        const result = await driver.executeMany(
            'INSERT INTO docs (name, body) VALUES (:name, :body) RETURNING id INTO :id',
            [
                { name: 'ñandú', body: { type: 'clob', val: long } },
                { name: 'b', body: { type: 'clob', val: 'short' } },
            ],
            { bindDefs: { id: { dir: 'returning', type: 'number' } } },
        );
        expect(result).toEqual({ rowsAffected: 2, outBinds: [{ id: [1] }, { id: [2] }] });
        const call = pool.calls.at(-1)!;
        expect(call.binds).toEqual([
            { name: 'ñandú', body: long },
            { name: 'b', body: 'short' },
        ]);
        expect(call.options.bindDefs).toEqual({
            name: { dir: oracledb.BIND_IN, type: oracledb.DB_TYPE_VARCHAR, maxSize: 7 },
            body: { dir: oracledb.BIND_IN, type: oracledb.DB_TYPE_CLOB },
            id: { dir: oracledb.BIND_OUT, type: oracledb.DB_TYPE_NUMBER },
        });
    });

    test('executeMany() with plain rows lets node-oracledb infer the types', async () => {
        const { driver, pool } = await startedDriver();
        await driver.executeMany('INSERT INTO t (a) VALUES (:a)', [{ a: 1 }]);
        expect(pool.calls.at(-1)!.options.bindDefs).toBeUndefined();
    });
});
