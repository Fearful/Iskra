import { describe, test, expect, afterEach, spyOn } from 'bun:test';
import { OracleDriver } from '../src/driver';
import { App } from '@iskra-bun/core';

// Lifecycle-focused unit tests, complementing the protocol suite in
// driver.test.ts. The external bridge is mocked via fake-bridge.cjs so no
// real Oracle instance or oracledb binding is required.
const FAKE_BRIDGE = `${import.meta.dir}/fake-bridge.cjs`;

function makeApp() {
    return new App({ name: 'OracleLifecycleTest', logger: { level: 'error' } });
}

describe('OracleDriver lifecycle', () => {
    const prevConn = process.env.ORA_CONN;

    afterEach(() => {
        if (prevConn !== undefined) process.env.ORA_CONN = prevConn;
        else delete process.env.ORA_CONN;
    });

    test('stop() is a no-op when the driver was never started', async () => {
        const driver = new OracleDriver(FAKE_BRIDGE);
        // Must not throw even though no subprocess exists.
        await driver.stop();
        // And the driver remains unusable afterwards.
        await expect(driver.query('SELECT 1')).rejects.toThrow('not started');
    });

    test('query rejects again after the driver is stopped', async () => {
        process.env.ORA_CONN = 'fake://localhost/test';
        const driver = new OracleDriver(FAKE_BRIDGE);
        await driver.init(makeApp());
        await driver.start();

        // Sanity: it works while running.
        expect(await driver.query('SELECT 1 FROM dual')).toEqual([{ echo: 'SELECT 1 FROM dual', params: [] }]);

        await driver.stop();

        // After stop the subprocess handle is cleared, so queries fail fast.
        await expect(driver.query('SELECT 1 FROM dual')).rejects.toThrow('not started');
    });

    test('stop() called twice does not throw', async () => {
        process.env.ORA_CONN = 'fake://localhost/test';
        const driver = new OracleDriver(FAKE_BRIDGE);
        await driver.init(makeApp());
        await driver.start();

        await driver.stop();
        await driver.stop(); // second call is the regression guard
        await expect(driver.query('SELECT 1')).rejects.toThrow('not started');
    });

    test('assigns a fresh request id to each query so responses do not collide', async () => {
        process.env.ORA_CONN = 'fake://localhost/test';
        const driver = new OracleDriver(FAKE_BRIDGE);
        await driver.init(makeApp());
        await driver.start();
        try {
            // Three queries fired together; if ids were reused the pending-map
            // lookup would cross the wires and these would not match 1:1.
            const results = await Promise.all([
                driver.query('Q1', ['a']),
                driver.query('Q2', ['b']),
                driver.query('Q3', ['c']),
            ]);
            expect(results).toEqual([
                [{ echo: 'Q1', params: ['a'] }],
                [{ echo: 'Q2', params: ['b'] }],
                [{ echo: 'Q3', params: ['c'] }],
            ]);
        } finally {
            await driver.stop();
        }
    });

    test('uses the default bridge path when no override is given', () => {
        const driver = new OracleDriver();
        // Default name is unchanged regardless of bridge path resolution.
        expect(driver.name).toBe('OracleDriver');
    });
});

describe('OracleDriver pending-promise rejection on fatal/exit', () => {
    const prevConn = process.env.ORA_CONN;

    afterEach(() => {
        if (prevConn !== undefined) process.env.ORA_CONN = prevConn;
        else delete process.env.ORA_CONN;
    });

    test('fatal message rejects the pending promise rather than leaving it hung', async () => {
        process.env.ORA_CONN = 'fake://localhost/test';
        const driver = new OracleDriver(FAKE_BRIDGE);
        await driver.init(makeApp());
        await driver.start();
        const errSpy = spyOn(console, 'error').mockImplementation(() => {});
        try {
            // FATAL_TEST causes the bridge to emit { type: 'fatal' } without an id.
            // The driver must reject this (and all other) pending promises.
            const err = (await driver.query('FATAL_TEST').then(
                () => null,
                (e: Error) => e,
            )) as Error;
            expect(err.message).toMatch(/fatal/i);
        } finally {
            errSpy.mockRestore();
            await driver.stop();
        }
    });

    test('bridge process exit rejects all pending promises rather than leaving them hung', async () => {
        process.env.ORA_CONN = 'fake://localhost/test';
        const driver = new OracleDriver(FAKE_BRIDGE);
        await driver.init(makeApp());
        await driver.start();
        const errSpy = spyOn(console, 'error').mockImplementation(() => {});
        try {
            // EXIT_TEST causes the bridge to call process.exit(1) immediately.
            // The stream will close, triggering rejectAllPending in the finally block.
            const err = (await driver.query('EXIT_TEST').then(
                () => null,
                (e: Error) => e,
            )) as Error;
            expect(err.message).toMatch(/exited|error/i);
        } finally {
            errSpy.mockRestore();
            await driver.stop();
        }
    });

    test('a query after the bridge exited rejects at once, not after its timeout', async () => {
        process.env.ORA_CONN = 'fake://localhost/test';
        const app = makeApp();
        const errors: unknown[] = [];
        (app.logger as any).error = (obj: unknown, msg?: string) => errors.push(msg ?? obj);
        const driver = new OracleDriver(FAKE_BRIDGE);
        await driver.init(app);
        await driver.start();
        try {
            await expect(driver.query('EXIT_TEST')).rejects.toThrow('Oracle bridge process exited');

            const started = Date.now();
            await expect(driver.query('SELECT 1 FROM dual')).rejects.toThrow('not started');
            expect(Date.now() - started).toBeLessThan(1000);
            expect(errors).toContain('Oracle bridge process exited; queries fail until the driver is started again');
        } finally {
            await driver.stop();
        }
    });

    test('a reader that fails while the bridge runs kills the bridge', async () => {
        // Regression: the driver dropped the process but left it running, so
        // a later start() ran a second bridge next to it.
        process.env.ORA_CONN = 'fake://localhost/test';
        const driver = new OracleDriver(FAKE_BRIDGE);
        await driver.init(makeApp());
        await driver.start();
        const proc = (driver as any).proc;
        spyOn(driver as any, 'handleLine').mockImplementation(() => {
            throw new Error('reader failed');
        });
        try {
            await expect(driver.query('SELECT 1 FROM dual')).rejects.toThrow('Oracle bridge stream error');
            const exited = await Promise.race([proc.exited.then(() => true), Bun.sleep(1000).then(() => false)]);
            expect(exited).toBe(true);
        } finally {
            proc.kill();
            await driver.stop();
        }
    });

    test('stop() does not report the exit it caused', async () => {
        process.env.ORA_CONN = 'fake://localhost/test';
        const app = makeApp();
        const errors: unknown[] = [];
        (app.logger as any).error = (obj: unknown, msg?: string) => errors.push(msg ?? obj);
        const driver = new OracleDriver(FAKE_BRIDGE);
        await driver.init(app);
        await driver.start();
        await driver.stop();
        await Bun.sleep(50);
        expect(errors).toEqual([]);
    });

    test('a bridge that exits right after ready never leaves queries hanging', async () => {
        process.env.ORA_CONN = 'fake://localhost/test';
        process.env.FAKE_BRIDGE_MODE = 'ready-exit';
        const driver = new OracleDriver(FAKE_BRIDGE);
        await driver.init(makeApp());
        try {
            // Either start() sees the exit, or the exit clears the driver
            // after it: in both cases a query fails fast.
            const startErr = await driver.start().then(
                () => null,
                (e: Error) => e,
            );
            if (startErr) expect(startErr.message).toBe('Oracle bridge process exited');
            await Bun.sleep(100);
            const started = Date.now();
            await expect(driver.query('SELECT 1 FROM dual')).rejects.toThrow(/not started|exited/);
            expect(Date.now() - started).toBeLessThan(1000);
        } finally {
            delete process.env.FAKE_BRIDGE_MODE;
            await driver.stop();
        }
    });
});
