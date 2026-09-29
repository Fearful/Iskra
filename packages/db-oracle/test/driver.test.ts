import { afterEach, describe, expect, test } from 'bun:test';
import oracledb from 'oracledb';
import { OracleDriver } from '../src/driver';
import { ConnectionError, QueryError } from '../src/errors';
import { CONFIG, TestDriver, makeApp, oraError, startedDriver } from './fakes';

interface DB {
    USERS: { ID: number; NAME: string };
}

describe('OracleDriver lifecycle', () => {
    const saved = { ORA_CONN: process.env.ORA_CONN, ORA_USER: process.env.ORA_USER };

    afterEach(() => {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    });

    test('registers itself as `oracle` on the app context', async () => {
        const driver = new TestDriver();
        const app = makeApp();
        await driver.init(app);
        expect(app.context.get('oracle')).toBe(driver);
        expect(driver.name).toBe('OracleDriver');
    });

    test('does not start without app.config.oracle or ORA_CONN', async () => {
        delete process.env.ORA_CONN;
        const driver = new TestDriver();
        await driver.init(makeApp(null));
        await driver.start();
        expect(driver.poolAttributes).toBeUndefined();
        expect(driver.db).toBeUndefined();
        await expect(driver.query('SELECT 1 FROM DUAL')).rejects.toThrow('not started');
    });

    test('falls back to ORA_CONN, ORA_USER and ORA_PASSWORD', async () => {
        process.env.ORA_CONN = 'env-host:1521/XEPDB1';
        process.env.ORA_USER = 'env_user';
        const driver = new TestDriver();
        await driver.init(makeApp(null));
        await driver.start();
        expect(driver.poolAttributes).toMatchObject({ connectString: 'env-host:1521/XEPDB1', user: 'env_user' });
    });

    test('creates the pool from the config and checks it with a round trip', async () => {
        const { driver, pool } = await startedDriver({
            ...CONFIG,
            pool: { min: 1, max: 8, queueTimeout: 5000 },
            poolAttributes: { configDir: '/wallet' },
        });
        expect(driver.poolAttributes).toEqual({
            configDir: '/wallet',
            connectString: CONFIG.connectString,
            user: 'app',
            password: 'secret',
            poolMin: 1,
            poolMax: 8,
            poolIncrement: 1,
            queueTimeout: 5000,
        });
        expect(pool.calls.map((c) => c.sql)).toEqual(['SELECT 1 FROM DUAL']);
        expect(pool.connections[0]!.closed).toBe(1);
        expect(driver.db).toBeDefined();
    });

    test('start() fails with a ConnectionError carrying the ORA message, and closes the pool', async () => {
        const driver = new TestDriver();
        driver.fake.respond = () => oraError(1017, 'invalid credential or not authorized; logon denied');
        await driver.init(makeApp());
        const error = (await driver.start().catch((e: unknown) => e)) as ConnectionError;
        expect(error).toBeInstanceOf(ConnectionError);
        expect(error.message).toContain('ORA-01017');
        expect(error.context).toEqual({ connectString: CONFIG.connectString, user: 'app' });
        expect(JSON.stringify(error.toJSON())).not.toContain('secret');
        expect(driver.fake.closedWith).toBe(5);
        expect(driver.db).toBeUndefined();
    });

    test('rejects an invalid config', async () => {
        const driver = new TestDriver();
        await driver.init(makeApp({ connectString: 'x', pool: { max: 0 } }));
        await expect(driver.start()).rejects.toThrow('pool.max must be at least 1');
    });

    test('stop() closes the pool with drainTime and makes the driver unusable', async () => {
        const { driver, pool } = await startedDriver({ ...CONFIG, pool: { drainTime: 2 } });
        await driver.stop();
        expect(pool.closedWith).toBe(2);
        expect(driver.db).toBeUndefined();
        await expect(driver.query('SELECT 1 FROM DUAL')).rejects.toThrow('not started');
        await driver.stop();
    });

    test('ping() answers true while connected and false otherwise', async () => {
        const { driver, pool } = await startedDriver();
        expect(await driver.ping()).toBe(true);
        pool.respond = () => oraError(3113, 'end-of-file on communication channel');
        expect(await driver.ping()).toBe(false);
        await driver.stop();
        expect(await driver.ping()).toBe(false);
        expect(await new OracleDriver().ping()).toBe(false);
    });
});

describe('OracleDriver statements', () => {
    test('query() returns rows, with object rows, autoCommit and the LOB fetch handler', async () => {
        const { driver, pool } = await startedDriver();
        pool.respond = () => ({ rows: [{ ID: 1 }] });
        expect(await driver.query('SELECT id FROM users WHERE id = :id', { id: 1 })).toEqual([{ ID: 1 }]);
        const call = pool.calls.at(-1)!;
        expect(call.binds).toEqual({ id: 1 });
        expect(call.options.outFormat).toBe(oracledb.OUT_FORMAT_OBJECT);
        expect(call.options.autoCommit).toBe(true);
        const handler = call.options.fetchTypeHandler as (m: { dbType: unknown }) => unknown;
        expect(handler({ dbType: oracledb.DB_TYPE_CLOB })).toEqual({ type: oracledb.STRING });
        expect(handler({ dbType: oracledb.DB_TYPE_BLOB })).toEqual({ type: oracledb.BUFFER });
        expect(handler({ dbType: oracledb.DB_TYPE_NUMBER })).toBeUndefined();
        expect(call.connection.closed).toBe(1);
    });

    test('execute() translates typed binds, reads LOB out binds and reports rowsAffected', async () => {
        const { driver, pool } = await startedDriver();
        const lob = { getData: async () => 'long text', destroy: () => {} };
        pool.respond = () => ({ rowsAffected: 1, outBinds: { id: [42], body: lob } });
        const result = await driver.execute('INSERT … RETURNING id, body INTO :id, :body', {
            name: 'Ana',
            id: { dir: 'returning', type: 'number' },
            body: { dir: 'out', type: 'clob' },
        });
        expect(result.rowsAffected).toBe(1);
        expect(result.rows).toEqual([]);
        expect(result.outBinds).toEqual({ id: [42], body: 'long text' });
        // The out binds are typed from the bind definitions.
        const typed: { id: (number | null)[]; body: string | null } = result.outBinds;
        expect(typed.id[0]).toBe(42);
        expect(pool.calls.at(-1)!.binds).toEqual({
            name: 'Ana',
            id: { dir: oracledb.BIND_OUT, type: oracledb.DB_TYPE_NUMBER },
            body: { dir: oracledb.BIND_OUT, type: oracledb.DB_TYPE_CLOB },
        });
    });

    test('execute() gives rowsAffected 0 and empty outBinds for a query', async () => {
        const { driver, pool } = await startedDriver();
        pool.respond = () => ({ rows: [{ N: 1 }] });
        expect(await driver.execute('SELECT 1 AS n FROM DUAL')).toEqual({
            rows: [{ N: 1 }],
            rowsAffected: 0,
            outBinds: {},
        });
    });

    test('executeMany() runs the rows in one call', async () => {
        const { driver, pool } = await startedDriver();
        pool.respond = () => ({ rowsAffected: 2 });
        const rows = [{ name: 'a' }, { name: 'b' }];
        expect(await driver.executeMany('INSERT INTO users (name) VALUES (:name)', rows)).toEqual({
            rowsAffected: 2,
            outBinds: [],
        });
        expect(pool.calls.at(-1)!.binds).toEqual(rows);
    });

    test('a database error is a QueryError with the ORA number and code', async () => {
        const { driver, pool } = await startedDriver();
        pool.respond = () => oraError(1, 'unique constraint (APP.USERS_UK) violated');
        const error = (await driver.execute('INSERT …').catch((e: unknown) => e)) as QueryError;
        expect(error).toBeInstanceOf(QueryError);
        expect(error.message).toStartWith('ORA-00001');
        expect(error.errorNum).toBe(1);
        expect(error.context).toEqual({ errorCode: 'ORA-00001', errorNum: 1, oracleCode: 'ORA-00001' });
        expect(error.errorCode).toBe('ORA-00001');
        expect(pool.connections.at(-1)!.closed).toBe(1);
    });

    test('setOnQuery() sees every statement; a throwing hook is ignored', async () => {
        const { driver } = await startedDriver<DB>();
        const seen: [string, unknown][] = [];
        driver.setOnQuery((sql, binds) => {
            seen.push([sql, binds]);
            throw new Error('hook failure');
        });
        await driver.query('SELECT :1 FROM DUAL', [7]);
        await driver.db!.selectFrom('USERS').select('ID').where('ID', '=', 3).execute();
        expect(seen).toEqual([
            ['SELECT :1 FROM DUAL', [7]],
            ['select "ID" from "USERS" where "ID" = :1', [3]],
        ]);
    });

    test('stream() yields rows chunk by chunk, then closes the result set and the connection', async () => {
        const { driver, pool } = await startedDriver();
        const chunks = [[{ N: 1 }, { N: 2 }], [{ N: 3 }], []];
        let closed = 0;
        pool.respond = () => ({
            resultSet: { getRows: async () => chunks.shift()!, close: async () => void closed++ },
        });
        const rows: unknown[] = [];
        for await (const row of driver.stream('SELECT n FROM t', [], { chunkSize: 2 })) rows.push(row);
        expect(rows).toEqual([{ N: 1 }, { N: 2 }, { N: 3 }]);
        expect(pool.calls.at(-1)!.options.resultSet).toBe(true);
        expect(closed).toBe(1);
        expect(pool.connections.at(-1)!.closed).toBe(1);
    });

    test('stream() releases the connection when the loop breaks early', async () => {
        const { driver, pool } = await startedDriver();
        let closed = 0;
        pool.respond = () => ({
            resultSet: { getRows: async () => [{ N: 1 }, { N: 2 }], close: async () => void closed++ },
        });
        for await (const row of driver.stream('SELECT n FROM t')) {
            expect(row).toEqual({ N: 1 });
            break;
        }
        expect(closed).toBe(1);
        expect(pool.connections.at(-1)!.closed).toBe(1);
    });
});

describe('OracleDriver transactions', () => {
    test('transaction() runs on one connection with autoCommit off and commits', async () => {
        const { driver, pool } = await startedDriver<DB>();
        const result = await driver.transaction(async (tx) => {
            await tx.execute('INSERT INTO users (name) VALUES (:name)', { name: 'a' });
            await tx.db.updateTable('USERS').set({ NAME: 'b' }).where('ID', '=', 1).execute();
            return 'done';
        });
        expect(result).toBe('done');
        const calls = pool.calls.slice(1);
        expect(calls).toHaveLength(2);
        expect(new Set(calls.map((c) => c.connection)).size).toBe(1);
        expect(calls.every((c) => c.options.autoCommit === false)).toBe(true);
        const connection = calls[0]!.connection;
        expect([connection.commits, connection.rollbacks, connection.closed]).toEqual([1, 0, 1]);
    });

    test('transaction() rolls back and rethrows the callback error as it is', async () => {
        const { driver, pool } = await startedDriver();
        class NotFound extends Error {}
        const error = await driver
            .transaction(async (tx) => {
                await tx.query('SELECT 1 FROM DUAL');
                throw new NotFound('missing');
            })
            .catch((e: unknown) => e);
        expect(error).toBeInstanceOf(NotFound);
        const connection = pool.connections.at(-1)!;
        expect([connection.commits, connection.rollbacks, connection.closed]).toEqual([0, 1, 1]);
    });

    test('inside transaction(), oracle.* statements join it instead of taking another connection', async () => {
        const { driver, pool } = await startedDriver<DB>();
        await driver.transaction(async () => {
            await driver.execute('UPDATE users SET name = :n WHERE id = 1', { n: 'a' });
            await driver.query('SELECT 1 FROM DUAL');
            await driver.db!.selectFrom('USERS').select('ID').execute();
            await Promise.all([driver.queryOne('SELECT 2 FROM DUAL'), driver.executeMany('INSERT …', [{ a: 1 }])]);
        });
        const calls = pool.calls.slice(1);
        expect(new Set(calls.map((c) => c.connection)).size).toBe(1);
        expect(calls.every((c) => c.options.autoCommit === false)).toBe(true);
        expect(calls[0]!.connection.commits).toBe(1);
        // Outside it, statements commit on their own again.
        await driver.execute('INSERT INTO log (msg) VALUES (:m)', { m: 'after' });
        expect(pool.calls.at(-1)!.options.autoCommit).toBe(true);
    });

    test('work left running after the transaction ends takes a pool connection', async () => {
        const { driver, pool } = await startedDriver();
        let later!: Promise<unknown>;
        await driver.transaction(async () => {
            later = Bun.sleep(5).then(() => driver.execute('INSERT INTO log (msg) VALUES (:m)', { m: 'late' }));
        });
        await later;
        const last = pool.calls.at(-1)!;
        expect(last.options.autoCommit).toBe(true);
        expect(last.connection).not.toBe(pool.calls.at(-2)?.connection);
        // A transaction can open again there.
        await driver.transaction(async () => {});
    });

    test('transaction() inside another throws instead of waiting on its own locks', async () => {
        const { driver } = await startedDriver();
        await expect(driver.transaction(() => driver.transaction(async () => 1))).rejects.toThrow(
            'Oracle has no nested transactions',
        );
    });

    test('Kysely: autoCommit on by default, off inside db.transaction()', async () => {
        const { driver, pool } = await startedDriver<DB>();
        await driver.db!.insertInto('USERS').values({ ID: 1, NAME: 'a' }).execute();
        expect(pool.calls.at(-1)!.options.autoCommit).toBe(true);

        await driver.db!.transaction().execute(async (trx) => {
            await trx.insertInto('USERS').values({ ID: 2, NAME: 'b' }).execute();
            await trx.insertInto('USERS').values({ ID: 3, NAME: 'c' }).execute();
        });
        const inTx = pool.calls.slice(-2);
        expect(inTx.every((c) => c.options.autoCommit === false)).toBe(true);
        expect(inTx[0]!.connection.commits).toBe(1);

        await driver.db!.insertInto('USERS').values({ ID: 4, NAME: 'd' }).execute();
        expect(pool.calls.at(-1)!.options.autoCommit).toBe(true);
    });

    test('Kysely: a failing db.transaction() rolls back', async () => {
        const { driver, pool } = await startedDriver<DB>();
        pool.respond = ({ sql }) =>
            sql.startsWith('insert') ? oraError(1, 'unique constraint violated') : { rows: [] };
        await expect(
            driver.db!.transaction().execute((trx) => trx.insertInto('USERS').values({ ID: 1, NAME: 'a' }).execute()),
        ).rejects.toThrow('ORA-00001');
        const connection = pool.connections.at(-1)!;
        expect([connection.commits, connection.rollbacks, connection.closed]).toEqual([0, 1, 1]);
    });

    test('Kysely: isolation level and savepoints', async () => {
        const { driver, pool } = await startedDriver<DB>();
        await driver
            .db!.transaction()
            .setIsolationLevel('serializable')
            .execute(async (trx) => {
                await trx.selectFrom('USERS').selectAll().execute();
            });
        expect(pool.statements[0]).toBe('set transaction isolation level serializable');

        const trx = await driver.db!.startTransaction().execute();
        const sp = await trx.savepoint('before_insert').execute();
        await sp.rollbackToSavepoint('before_insert').execute();
        await trx.commit().execute();
        expect(pool.statements.slice(-2)).toEqual([
            'savepoint "before_insert"',
            'rollback to savepoint "before_insert"',
        ]);

        await expect(
            driver
                .db!.transaction()
                .setIsolationLevel('repeatable read')
                .execute(async () => {}),
        ).rejects.toThrow('read committed and serializable');
    });

    test('tx.db cannot open a nested transaction', async () => {
        const { driver } = await startedDriver<DB>();
        await expect(driver.transaction((tx) => tx.db.transaction().execute(async () => {}))).rejects.toThrow(
            'no nested transactions',
        );
    });
});

describe('OracleDriver with camelCase', () => {
    test('maps camelCase names to UPPER_SNAKE_CASE and rows back', async () => {
        const { driver, pool } = await startedDriver<{ appUsers: { userId: number; firstName: string } }>({
            ...CONFIG,
            camelCase: true,
        });
        pool.respond = () => ({ rows: [{ USER_ID: 1, FIRST_NAME: 'Ana' }] });
        const rows = await driver.db!.selectFrom('appUsers').select(['userId', 'firstName']).execute();
        expect(pool.calls.at(-1)!.sql).toBe('select "USER_ID", "FIRST_NAME" from "APP_USERS"');
        expect(rows).toEqual([{ userId: 1, firstName: 'Ana' }]);
    });
});
