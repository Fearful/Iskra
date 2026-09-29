import { describe, expect, test } from 'bun:test';
import { ConfigError } from '@iskra-bun/core';
import { resolveConfig } from '../src/config';
import { DeadlineError, QueryError, toQueryError } from '../src/errors';
import type { OracleResultSetLike } from '../src/types';
import { CONFIG, oraError, startedDriver } from './fakes';

/** A call the database never answers, until `answer()`. */
function hung<T>() {
    let answer!: (value: T) => void;
    const promise = new Promise<T>((resolve) => (answer = resolve));
    return { promise, answer };
}

describe('the deadline of a call', () => {
    test('is its timeout plus the grace: past it the call fails and its connection is given up', async () => {
        const { driver, pool } = await startedDriver({ ...CONFIG, callTimeout: 20, deadlineGrace: 10 });
        const call = hung<{ rows: unknown[] }>();
        pool.respond = () => call.promise;

        const started = performance.now();
        const error = (await driver.query('SELECT slow FROM t').catch((e: unknown) => e)) as DeadlineError;
        expect(error).toBeInstanceOf(DeadlineError);
        expect(error).toBeInstanceOf(QueryError);
        expect(error.deadlineMs).toBe(30);
        expect(error.timedOut).toBe(true);
        expect(performance.now() - started).toBeLessThan(1000);

        // Its socket is closed, so the call fails and the connection is dropped at once.
        const connection = pool.connections.at(-1)!;
        expect(connection.disconnects).toBe(1);
        await Bun.sleep(5);
        expect(connection.closed).toBe(1);
        expect(connection.dropped).toBe(true);
    });

    test('without a Thin socket to close, asks node-oracledb to cancel and drops the connection when the call ends', async () => {
        const { driver, pool } = await startedDriver({ ...CONFIG, callTimeout: 10 });
        pool.thin = false;
        const call = hung<{ rows: unknown[] }>();
        pool.respond = () => call.promise;

        await expect(driver.query('SELECT slow FROM t')).rejects.toBeInstanceOf(DeadlineError);
        const connection = pool.connections.at(-1)!;
        expect(connection.breaks).toBe(1);
        expect(connection.closed).toBe(0);
        call.answer({ rows: [] });
        await Bun.sleep(5);
        expect(connection.closed).toBe(1);
        expect(connection.dropped).toBe(true);
    });

    test('an abort the database does not honor gives up on the connection after the grace', async () => {
        const { driver, pool } = await startedDriver({ ...CONFIG, deadlineGrace: 20 });
        pool.respond = () => hung<{ rows: unknown[] }>().promise;
        const controller = new AbortController();
        const running = driver.query('SELECT slow FROM t', [], { signal: controller.signal }).catch((e: unknown) => e);
        await Bun.sleep(5);
        controller.abort();

        const error = (await running) as QueryError;
        expect(error).toBeInstanceOf(QueryError);
        expect(error.errorCode).toBe('ORA-01013');
        expect(error.message).toContain('did not stop within 20 ms');
        const connection = pool.connections.at(-1)!;
        expect(connection.breaks).toBe(1);
        expect(connection.disconnects).toBe(1);
    });

    test('defaults to twice the timeout, at most 5 s more', async () => {
        const { driver, pool } = await startedDriver({ ...CONFIG, callTimeout: 15 });
        pool.respond = () => hung<{ rows: unknown[] }>().promise;
        const short = (await driver.query('SELECT 1 FROM t').catch((e: unknown) => e)) as DeadlineError;
        expect(short.deadlineMs).toBe(30);

        const long = (await driver
            .query('SELECT 1 FROM t', [], { timeout: 10 })
            .catch((e: unknown) => e)) as DeadlineError;
        expect(long.deadlineMs).toBe(20);
    });

    test('a call without a timeout waits for as long as it takes', async () => {
        const { driver, pool } = await startedDriver({ ...CONFIG, callTimeout: 5 });
        pool.respond = async () => {
            await Bun.sleep(40);
            return { rows: [{ N: 1 }] };
        };
        expect(await driver.query('SELECT n FROM report', [], { timeout: 0 })).toEqual([{ N: 1 }]);
    });

    test('the pool keeps serving after a call is given up', async () => {
        const { driver, pool } = await startedDriver({ ...CONFIG, callTimeout: 10 });
        pool.respond = () => hung<{ rows: unknown[] }>().promise;
        await expect(driver.execute('UPDATE t SET x = 1')).rejects.toBeInstanceOf(DeadlineError);

        pool.respond = () => ({ rows: [{ OK: 1 }] });
        expect(await driver.query('SELECT 1 AS ok FROM DUAL')).toEqual([{ OK: 1 }]);
    });

    test('bounds a Kysely query', async () => {
        const { driver, pool } = await startedDriver<{ T: { X: number } }>({ ...CONFIG, callTimeout: 10 });
        pool.respond = () => hung<{ rows: unknown[] }>().promise;
        await expect(driver.db!.selectFrom('T').selectAll().execute()).rejects.toBeInstanceOf(DeadlineError);
    });

    test('bounds each fetch of a stream, and does not wait to close its result set', async () => {
        const { driver, pool } = await startedDriver({ ...CONFIG, callTimeout: 10 });
        let closes = 0;
        let fetches = 0;
        const resultSet: OracleResultSetLike = {
            getRows: () => (++fetches === 1 ? Promise.resolve([{ N: 1 }]) : hung<unknown[]>().promise),
            close: async () => {
                closes++;
            },
        };
        pool.respond = () => ({ resultSet });

        const rows: unknown[] = [];
        const error = await (async () => {
            for await (const row of driver.stream('SELECT n FROM big')) rows.push(row);
        })().catch((e: unknown) => e);
        expect(rows).toEqual([{ N: 1 }]);
        expect(error).toBeInstanceOf(DeadlineError);
        expect(closes).toBe(0);
    });
});

describe('a transaction with a call past its deadline', () => {
    test('is lost: later statements and the commit fail, and nothing waits on the connection', async () => {
        const { driver, pool } = await startedDriver({ ...CONFIG, callTimeout: 10 });
        pool.respond = (call) => (call.sql.startsWith('UPDATE') ? hung<{ rows: unknown[] }>().promise : { rows: [] });

        const error = await driver
            .transaction(async (tx) => {
                await tx.execute('UPDATE accounts SET balance = 0').catch((e: unknown) => {
                    expect(e).toBeInstanceOf(DeadlineError);
                });
                await expect(tx.execute('INSERT INTO audit VALUES (1)')).rejects.toThrow('given up');
                return 'swallowed';
            })
            .catch((e: unknown) => e);

        expect(error).toBeInstanceOf(QueryError);
        expect((error as QueryError).message).toContain('given up');
        const connection = pool.connections.at(-1)!;
        expect(connection.commits).toBe(0);
        expect(connection.rollbacks).toBe(0);
        expect(pool.statements).toEqual(['UPDATE accounts SET balance = 0']);
    });

    test('rethrows its error without trying to roll back', async () => {
        const { driver, pool } = await startedDriver({ ...CONFIG, callTimeout: 10 });
        pool.respond = () => hung<{ rows: unknown[] }>().promise;
        const error = await driver.transaction((tx) => tx.execute('DELETE FROM t')).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(DeadlineError);
        expect(pool.connections.at(-1)!.rollbacks).toBe(0);
    });

    test('a commit the database never answers is bounded too', async () => {
        const { driver, pool } = await startedDriver({ ...CONFIG, callTimeout: 10 });
        pool.onCommit = () => hung<void>().promise;
        const error = await driver.transaction((tx) => tx.execute('DELETE FROM t')).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(DeadlineError);
        expect(pool.connections.at(-1)!.rollbacks).toBe(0);
    });
});

describe('a Kysely transaction with a call past its deadline', () => {
    test('rethrows the DeadlineError, not a failed rollback', async () => {
        const { driver, pool } = await startedDriver<{ T: { X: number } }>({ ...CONFIG, callTimeout: 10 });
        pool.respond = (call) => (call.sql.startsWith('update') ? hung<{ rows: unknown[] }>().promise : { rows: [] });
        const error = await driver
            .db!.transaction()
            .execute((trx) => trx.updateTable('T').set({ X: 1 }).execute())
            .catch((e: unknown) => e);
        expect(error).toBeInstanceOf(DeadlineError);
        expect(pool.connections.at(-1)!.rollbacks).toBe(0);
    });
});

describe('statements in one transaction', () => {
    test('run one at a time, each with its own timeout', async () => {
        const { driver, pool } = await startedDriver();
        pool.respond = async () => {
            await Bun.sleep(5);
            return { rows: [] };
        };
        await driver.transaction(async (tx) => {
            await Promise.all([
                tx.query('SELECT a FROM t', [], { timeout: 100 }),
                tx.query('SELECT b FROM t', [], { timeout: 200 }),
                tx.query('SELECT c FROM t'),
            ]);
        });
        const connection = pool.connections.at(-1)!;
        expect(connection.timeouts).toEqual([100, 200, 30_000]);
        expect(connection.callTimeout).toBe(30_000);
    });
});

describe('ping()', () => {
    test('drops a connection that answers after pingTimeout', async () => {
        const { driver, pool } = await startedDriver({ ...CONFIG, pingTimeout: 20 });
        const call = hung<{ rows: unknown[] }>();
        pool.respond = () => call.promise;

        expect(await driver.ping()).toBe(false);
        const connection = pool.connections.at(-1)!;
        expect(connection.disconnects).toBe(1);
        await Bun.sleep(5);
        expect(connection.dropped).toBe(true);
        call.answer({ rows: [] });
    });

    test('keeps a connection that answers in time', async () => {
        const { driver, pool } = await startedDriver({ ...CONFIG, pingTimeout: 200 });
        expect(await driver.ping()).toBe(true);
        expect(pool.connections.at(-1)!.dropped).toBe(false);
    });
});

describe('timedOut', () => {
    test('is true for NJS-123 and the deadline, false for other errors', () => {
        const njs123 = Object.assign(new Error('NJS-123: call timeout of 10 ms exceeded'), { code: 'NJS-123' });
        expect(toQueryError(njs123).timedOut).toBe(true);
        expect(toQueryError(oraError(1, 'unique constraint violated')).timedOut).toBe(false);
        expect(new DeadlineError(10).timedOut).toBe(true);
    });
});

describe('deadlineGrace', () => {
    test('is an integer of milliseconds >= 0, unset by default', () => {
        expect(resolveConfig(CONFIG)?.deadlineGrace).toBeUndefined();
        expect(resolveConfig({ ...CONFIG, deadlineGrace: 0 })?.deadlineGrace).toBe(0);
        expect(() => resolveConfig({ ...CONFIG, deadlineGrace: -1 })).toThrow(ConfigError);
        expect(() => resolveConfig({ ...CONFIG, deadlineGrace: '5s' })).toThrow('deadlineGrace');
    });
});
