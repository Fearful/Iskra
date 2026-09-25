import { describe, it, expect } from 'bun:test';
import { existsSync } from 'node:fs';
import { createTestApp, createMockLogger, createMockDriver, withTempDir, createTestServer } from '../src/index';

// ─── createTestApp ────────────────────────────────────────────────────────────

describe('createTestApp', () => {
    it('returns a startable and stoppable App', async () => {
        const app = createTestApp();
        await expect(app.start()).resolves.toBeUndefined();
        await expect(app.stop()).resolves.toBeUndefined();
    });

    it('uses the default name "TestApp"', () => {
        const app = createTestApp();
        expect(app.config.name).toBe('TestApp');
    });

    it('accepts overrides that are merged into the config', () => {
        const app = createTestApp({ name: 'CustomApp' });
        expect(app.config.name).toBe('CustomApp');
    });

    it('registers and calls drivers during start/stop lifecycle', async () => {
        const app = createTestApp();
        const driver = createMockDriver();
        app.register(driver);

        await app.start();
        expect(driver.calls).toContain('init');
        expect(driver.calls).toContain('start');

        await app.stop();
        expect(driver.calls).toContain('stop');
    });
});

// ─── createMockLogger ─────────────────────────────────────────────────────────

describe('createMockLogger', () => {
    it('captures info calls', () => {
        const logger = createMockLogger();
        logger.info('hello world');
        expect(logger.logs.info).toHaveLength(1);
        expect(logger.logs.info[0]!.args[0]).toBe('hello world');
    });

    it('captures error calls with an object binding', () => {
        const logger = createMockLogger();
        logger.error({ code: 42 }, 'something failed');
        expect(logger.logs.error).toHaveLength(1);
        expect(logger.logs.error[0]!.args[0]).toEqual({ code: 42 });
        expect(logger.logs.error[0]!.args[1]).toBe('something failed');
    });

    it('captures across all levels', () => {
        const logger = createMockLogger();
        logger.trace('t');
        logger.debug('d');
        logger.info('i');
        logger.warn('w');
        logger.error('e');
        logger.fatal('f');

        expect(logger.logs.trace).toHaveLength(1);
        expect(logger.logs.debug).toHaveLength(1);
        expect(logger.logs.info).toHaveLength(1);
        expect(logger.logs.warn).toHaveLength(1);
        expect(logger.logs.error).toHaveLength(1);
        expect(logger.logs.fatal).toHaveLength(1);
    });

    it('reset() clears all captured logs', () => {
        const logger = createMockLogger();
        logger.info('one');
        logger.error('two');
        logger.reset();

        expect(logger.logs.info).toHaveLength(0);
        expect(logger.logs.error).toHaveLength(0);
    });

    it('child() returns the same capturing mock', () => {
        const logger = createMockLogger();
        const child = logger.child({ request: 'abc' });
        child.info('from child');
        // child shares parent arrays
        expect(logger.logs.info).toHaveLength(1);
    });

    it('produces no stdout/stderr output', async () => {
        // If pino's transport were active, importing would add noise.
        // We just confirm no transport property leaks through.
        const logger = createMockLogger();
        // The mock doesn't have a "stream" or "transport" that would write
        expect((logger as any).transport).toBeUndefined();
    });
});

// ─── createMockDriver ─────────────────────────────────────────────────────────

describe('createMockDriver', () => {
    it('records lifecycle calls in order', async () => {
        const app = createTestApp();
        const driver = createMockDriver();
        app.register(driver);

        await app.start();
        await app.stop();

        expect(driver.calls).toEqual(['init', 'start', 'stop']);
    });

    it('sets initialized/started/stopped flags', async () => {
        const app = createTestApp();
        const driver = createMockDriver();
        app.register(driver);

        expect(driver.initialized).toBe(false);
        await app.start();
        expect(driver.initialized).toBe(true);
        expect(driver.started).toBe(true);
        expect(driver.stopped).toBe(false);

        await app.stop();
        expect(driver.stopped).toBe(true);
    });

    it('invokes the user-supplied init hook', async () => {
        const hookCalls: string[] = [];
        const app = createTestApp();
        const driver = createMockDriver('hooked', {
            init: async () => {
                hookCalls.push('init-hook');
            },
        });
        app.register(driver);
        await app.start();
        await app.stop();

        expect(hookCalls).toContain('init-hook');
    });

    it('propagates a throwing stop hook', async () => {
        const app = createTestApp();
        const driver = createMockDriver('boom', {
            stop: async () => {
                throw new Error('stop-exploded');
            },
        });
        app.register(driver);
        await app.start();
        // App.stop() surfaces driver failures as a LifecycleError
        await expect(app.stop()).rejects.toThrow();
        expect(driver.calls).toContain('stop');
    });

    it('reset() clears recorded state', async () => {
        const app = createTestApp();
        const driver = createMockDriver();
        app.register(driver);
        await app.start();
        await app.stop();

        driver.reset();
        expect(driver.calls).toHaveLength(0);
        expect(driver.initialized).toBe(false);
        expect(driver.started).toBe(false);
        expect(driver.stopped).toBe(false);
    });

    it('accepts a custom name', () => {
        const driver = createMockDriver('my-driver');
        expect(driver.name).toBe('my-driver');
    });
});

// ─── withTempDir ─────────────────────────────────────────────────────────────

describe('withTempDir', () => {
    it('creates a directory that exists during fn', async () => {
        let capturedDir = '';
        await withTempDir(async (dir) => {
            capturedDir = dir;
            expect(existsSync(dir)).toBe(true);
        });
        // After fn returns the directory must be gone
        expect(existsSync(capturedDir)).toBe(false);
    });

    it('cleans up even when fn throws', async () => {
        let capturedDir = '';
        const error = new Error('fn-threw');

        await expect(
            withTempDir(async (dir) => {
                capturedDir = dir;
                throw error;
            }),
        ).rejects.toThrow('fn-threw');

        expect(existsSync(capturedDir)).toBe(false);
    });

    it('returns the value resolved by fn', async () => {
        const result = await withTempDir(async () => 42);
        expect(result).toBe(42);
    });
});

// ─── createTestServer ─────────────────────────────────────────────────────────

describe('createTestServer', () => {
    // A minimal handler that implements the structural interface without Hono
    function makeHandler() {
        return {
            request(input: string | Request | URL, init?: RequestInit) {
                const url = typeof input === 'string' ? input : input.toString();
                const method = init?.method ?? 'GET';
                return new Response(JSON.stringify({ url, method }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            },
        };
    }

    it('GET passes method and path', async () => {
        const client = createTestServer(makeHandler());
        const res = await client.get('/ping');
        expect(res.status).toBe(200);
        const body = (await res.json()) as { url: string; method: string };
        expect(body.method).toBe('GET');
        expect(body.url).toContain('/ping');
    });

    it('POST serialises body as JSON', async () => {
        const captured: string[] = [];
        const client = createTestServer({
            request(_input, init) {
                captured.push((init?.body as string) ?? '');
                return new Response('ok', { status: 201 });
            },
        });
        await client.post('/items', { name: 'test' });
        expect(JSON.parse(captured[0]!)).toEqual({ name: 'test' });
    });

    it('DELETE sends the right method', async () => {
        const client = createTestServer(makeHandler());
        const res = await client.delete('/items/1');
        const body = (await res.json()) as { method: string };
        expect(body.method).toBe('DELETE');
    });
});
