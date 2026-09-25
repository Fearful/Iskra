import { describe, test, expect, afterEach, spyOn } from 'bun:test';
import { OracleDriver } from '../src/driver';
import { App } from '@iskra-bun/core';

// Tests capturing the desired FIXED behavior for the db-oracle audit findings.
// The external bridge is mocked via fake-bridge.cjs so no real Oracle / oracledb
// binding is required.
const FAKE_BRIDGE = `${import.meta.dir}/fake-bridge.cjs`;

function makeApp() {
    return new App({ name: 'OracleAuditTest', logger: { level: 'error' } });
}

// ---------------------------------------------------------------------------
// MEDIUM — query() must not hang when stdin.write is unavailable.
//
// Current bug (src/driver.ts:71): the pending promise is registered in the
// map, but the `if (stdin.write)` guard silently skips writing when write is
// falsy. rejectAllPending only fires on close/fatal, so the promise hangs
// forever. The fix must reject immediately in the else branch.
// ---------------------------------------------------------------------------
describe('OracleDriver query() — stdin.write unavailable', () => {
    const prevConn = process.env.ORA_CONN;

    afterEach(() => {
        if (prevConn !== undefined) process.env.ORA_CONN = prevConn;
        else delete process.env.ORA_CONN;
    });

    // Install a fake subprocess whose stdin writer lacks a `write` method.
    // `proc.stdin` is a readonly property on a real Bun Subprocess, so we swap
    // the entire `proc` handle instead of reassigning stdin.
    function installWriterlessProc(driver: OracleDriver) {
        (driver as any).proc = {
            // stdout is read once in start(); we are past start() here so it is
            // unused, but provide a harmless value.
            stdout: undefined,
            // Writer with no `write` — the bug's `if (stdin.write)` guard skips
            // the write and the promise is left hanging.
            stdin: { flush: () => {} },
            kill: () => {},
        };
    }

    test('rejects (not hangs) when the stdin writer has no write method', async () => {
        process.env.ORA_CONN = 'fake://localhost/test';
        const driver = new OracleDriver(FAKE_BRIDGE);
        await driver.init(makeApp());
        await driver.start();
        try {
            installWriterlessProc(driver);

            const result = await Promise.race([
                driver.query('SELECT 1 FROM dual').then(
                    () => 'resolved',
                    () => 'rejected',
                ),
                new Promise<string>((r) => setTimeout(() => r('hung'), 250)),
            ]);

            expect(result).toBe('rejected');
        } finally {
            await driver.stop();
        }
    });

    test('the rejection does not leave the request stuck in the pending map', async () => {
        process.env.ORA_CONN = 'fake://localhost/test';
        const driver = new OracleDriver(FAKE_BRIDGE);
        await driver.init(makeApp());
        await driver.start();
        try {
            installWriterlessProc(driver);

            // Bound the wait so a hung (buggy) promise fails the assertion
            // instead of being killed by the harness timeout.
            await Promise.race([
                driver.query('SELECT 1 FROM dual').catch(() => {}),
                new Promise((r) => setTimeout(r, 250)),
            ]);

            // A failed write must not orphan an entry in the pending map.
            expect((driver as any).pending.size).toBe(0);
        } finally {
            await driver.stop();
        }
    });
});

// ---------------------------------------------------------------------------
// MEDIUM — a per-request timeout must reject a query whose response never
// arrives, instead of leaving the promise pending forever.
// ---------------------------------------------------------------------------
describe('OracleDriver query() — per-request timeout', () => {
    const prevConn = process.env.ORA_CONN;

    afterEach(() => {
        if (prevConn !== undefined) process.env.ORA_CONN = prevConn;
        else delete process.env.ORA_CONN;
    });

    test('rejects with a timeout when the bridge never responds', async () => {
        process.env.ORA_CONN = 'fake://localhost/test';
        // NO_RESPONSE_TEST is handled by the fake bridge as a black hole: the
        // request is accepted but never answered. Without a per-request
        // timeout this hangs forever.
        const driver = new OracleDriver(FAKE_BRIDGE, 200);
        await driver.init(makeApp());
        await driver.start();
        try {
            const result = await Promise.race([
                driver.query('NO_RESPONSE_TEST').then(
                    () => 'resolved',
                    (e: Error) => `rejected:${e.message}`,
                ),
                new Promise<string>((r) => setTimeout(() => r('hung'), 1500)),
            ]);

            expect(result).not.toBe('hung');
            expect(result).toMatch(/^rejected:/);
            expect(result).toMatch(/timeout|timed out/i);
        } finally {
            await driver.stop();
        }
    });

    test('a timed-out request is removed from the pending map', async () => {
        process.env.ORA_CONN = 'fake://localhost/test';
        const driver = new OracleDriver(FAKE_BRIDGE, 200);
        await driver.init(makeApp());
        await driver.start();
        try {
            // Bound the wait so a never-resolving (no-timeout) query fails the
            // assertion rather than being killed by the harness timeout.
            await Promise.race([
                driver.query('NO_RESPONSE_TEST').catch(() => {}),
                new Promise((r) => setTimeout(r, 600)),
            ]);
            expect((driver as any).pending.size).toBe(0);
        } finally {
            await driver.stop();
        }
    });
});

// ---------------------------------------------------------------------------
// MEDIUM — library code must route diagnostics through app.logger, not the
// global console. The driver should retain `this.app` from init/start and use
// app.logger.error for fatal, parse, and stream errors.
// ---------------------------------------------------------------------------
describe('OracleDriver logging — routes through app.logger, not console', () => {
    const prevConn = process.env.ORA_CONN;

    afterEach(() => {
        if (prevConn !== undefined) process.env.ORA_CONN = prevConn;
        else delete process.env.ORA_CONN;
    });

    test('logs a fatal bridge message via app.logger.error, not console.error', async () => {
        process.env.ORA_CONN = 'fake://localhost/test';
        const app = makeApp();
        const loggerSpy = spyOn(app.logger, 'error').mockImplementation((() => {}) as any);
        const consoleSpy = spyOn(console, 'error').mockImplementation(() => {});
        const driver = new OracleDriver(FAKE_BRIDGE);
        await driver.init(app);
        await driver.start();
        try {
            await driver.query('FATAL_TEST').catch(() => {});
            expect(loggerSpy).toHaveBeenCalled();
            expect(consoleSpy).not.toHaveBeenCalled();
        } finally {
            loggerSpy.mockRestore();
            consoleSpy.mockRestore();
            await driver.stop();
        }
    });

    test('logs a malformed bridge line via app.logger.error, not console.error', async () => {
        process.env.ORA_CONN = 'fake://localhost/test';
        const app = makeApp();
        const loggerSpy = spyOn(app.logger, 'error').mockImplementation((() => {}) as any);
        const consoleSpy = spyOn(console, 'error').mockImplementation(() => {});
        const driver = new OracleDriver(FAKE_BRIDGE);
        await driver.init(app);
        await driver.start();
        try {
            // BAD_JSON_TEST emits an unparsable line followed by a valid
            // response; the parse error must be logged through app.logger.
            const rows = await driver.query('BAD_JSON_TEST');
            expect(rows).toEqual([{ recovered: true }]);
            expect(loggerSpy).toHaveBeenCalled();
            expect(consoleSpy).not.toHaveBeenCalled();
        } finally {
            loggerSpy.mockRestore();
            consoleSpy.mockRestore();
            await driver.stop();
        }
    });
});
