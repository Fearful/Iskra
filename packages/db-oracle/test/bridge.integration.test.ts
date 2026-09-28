import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { App } from '@iskra-bun/core';
import { OracleDriver } from '../src/driver';
import { ORACLE, oracleUp } from './oracle-env';

// The OracleDriver as shipped: bridge/runner.js under Node, against a real
// database. The other suites replace the bridge with fake-bridge.cjs. Skipped
// unless the database in oracle-env.ts is reachable; the `oracle` CI job
// provides one.
setDefaultTimeout(30_000);

const up = await oracleUp();
const VARS = ['ORA_CONN', 'ORA_USER', 'ORA_PASSWORD'] as const;

(up ? describe : describe.skip)('OracleDriver with the Node bridge (real Oracle)', () => {
    const saved = Object.fromEntries(VARS.map((name) => [name, process.env[name]]));
    let driver: OracleDriver | undefined;

    function useCredentials(password = ORACLE.password) {
        process.env.ORA_CONN = ORACLE.connectString;
        process.env.ORA_USER = ORACLE.user;
        process.env.ORA_PASSWORD = password;
    }

    async function startDriver() {
        driver = new OracleDriver();
        await driver.init(new App({ name: 'OracleBridgeIntegration', logger: { level: 'error' } }));
        await driver.start();
        return driver;
    }

    afterEach(async () => {
        await driver?.stop();
        driver = undefined;
        for (const name of VARS) {
            if (saved[name] === undefined) delete process.env[name];
            else process.env[name] = saved[name];
        }
    });

    test('starts, runs queries with binds and stops', async () => {
        useCredentials();
        const oracle = await startDriver();
        expect(await oracle.query('SELECT :1 AS n, :2 AS s FROM DUAL', [42, 'Ñandú'])).toEqual([{ N: 42, S: 'Ñandú' }]);
        // Several queries in flight share the bridge's one connection.
        const results = await Promise.all([1, 2, 3].map((n) => oracle.query('SELECT :1 AS n FROM DUAL', [n])));
        expect(results).toEqual([[{ N: 1 }], [{ N: 2 }], [{ N: 3 }]]);
    });

    test('rejects a failing query with the ORA error, and keeps serving', async () => {
        useCredentials();
        const oracle = await startDriver();
        await expect(oracle.query('SELECT * FROM iskra_no_such_table')).rejects.toThrow(/ORA-00942/);
        expect(await oracle.query('SELECT 1 AS one FROM DUAL')).toEqual([{ ONE: 1 }]);
    });

    test('start() rejects with the ORA error for a wrong password', async () => {
        useCredentials('not-the-password');
        await expect(startDriver()).rejects.toThrow(/ORA-01017/);
    });
});
