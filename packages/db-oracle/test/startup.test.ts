import { describe, test, expect, afterEach } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { OracleDriver } from '../src/driver';
import { App } from '@iskra-bun/core';

const FAKE_BRIDGE = `${import.meta.dir}/fake-bridge.cjs`;
const makeApp = () => new App({ name: 'OracleStartupTest', logger: { level: 'silent' } });

async function startWith(mode: string | undefined, startTimeoutMs = 2000) {
    process.env.ORA_CONN = 'fake://localhost/test';
    if (mode) process.env.FAKE_BRIDGE_MODE = mode;
    else delete process.env.FAKE_BRIDGE_MODE;
    const driver = new OracleDriver(FAKE_BRIDGE, 30_000, startTimeoutMs);
    await driver.init(makeApp());
    const error = await driver.start().then(
        () => null,
        (e: Error) => e,
    );
    return { driver, error };
}

describe('OracleDriver startup', () => {
    afterEach(() => {
        delete process.env.FAKE_BRIDGE_MODE;
        delete process.env.ORA_CONN;
    });

    // Regression: start() returned before the bridge connected, so a bad
    // connect string only surfaced later as failed queries.
    test('fails start() when the bridge cannot connect', async () => {
        const { error } = await startWith('fatal');
        expect(error?.message).toContain('ORA-12541');
    });

    test('fails start() when the bridge exits before it is ready', async () => {
        const { error } = await startWith('exit');
        expect(error?.message).toMatch(/exited before it was ready/);
    });

    test('fails start() when the bridge never becomes ready', async () => {
        const { error } = await startWith('silent', 200);
        expect(error?.message).toMatch(/did not become ready within 200ms/);
    });

    test('fails start() clearly when the bridge script is missing', async () => {
        process.env.ORA_CONN = 'fake://localhost/test';
        const driver = new OracleDriver('/nonexistent/runner.js');
        await driver.init(makeApp());
        const error = await driver.start().then(
            () => null,
            (e: Error) => e,
        );
        expect(error?.message).toContain('bridge script not found');
    });

    test("a restarted driver is not affected by the previous bridge's shutdown", async () => {
        const { driver, error } = await startWith(undefined);
        expect(error).toBeNull();
        await driver.stop();
        await driver.start();
        try {
            expect(await driver.query('AFTER_RESTART')).toEqual([{ echo: 'AFTER_RESTART', params: [] }]);
        } finally {
            await driver.stop();
        }
    });
});

describe('@iskra-bun/db-oracle package', () => {
    const root = resolve(import.meta.dir, '..');
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

    // Regression: `files` did not include bridge/, so the published package
    // could never start (and oracledb was declared nowhere).
    test('publishes the bridge the driver spawns by default', () => {
        expect(pkg.files).toEqual(expect.arrayContaining(['bridge/runner.js', 'bridge/package.json']));
        expect(existsSync(join(root, 'bridge/runner.js'))).toBe(true);
        // bridge/package.json keeps runner.js CommonJS under the package's "type": "module".
        expect(JSON.parse(readFileSync(join(root, 'bridge/package.json'), 'utf8')).type).toBeUndefined();
    });

    test('declares oracledb, which the bridge requires', () => {
        expect(pkg.peerDependencies?.oracledb).toBeDefined();
    });
});
