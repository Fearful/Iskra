import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { Socket, TCPSocketListener } from 'bun';
import { Kernel } from '../src/kernel';
import { CacheFeature, redisClientArgs, type CacheAdapter } from '../src/features/cache';
import { RateLimitFeature } from '../src/features/rate-limit';
import type { Feature } from '../src/types';
import type { KernelLogger } from '../src/logging';

function recordingLogger() {
    const entries: { level: string; message: string; details?: unknown }[] = [];
    const at = (level: string) => (message: string, details?: unknown) => entries.push({ level, message, details });
    const logger: KernelLogger = { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') };
    return { logger, entries };
}

describe('redisClientArgs', () => {
    it("keeps ioredis' defaults without a URL", () => {
        const { url, options } = redisClientArgs({ adapter: 'redis' });
        expect(url).toBeUndefined();
        expect(options).toMatchObject({ host: 'localhost', port: 6379, db: 0, commandTimeout: 2000 });
        expect(options.tls).toBeUndefined();
    });

    it('passes a URL on its own, with only the fields that were given', () => {
        const { url, options } = redisClientArgs({
            adapter: 'redis',
            connection: { url: 'rediss://default:secret@cache.example.com:6380/2' },
        });
        expect(url).toBe('rediss://default:secret@cache.example.com:6380/2');
        // host/port/db would fill in what the URL leaves out: none given, none set.
        expect(options.host).toBeUndefined();
        expect(options.port).toBeUndefined();
        expect(options.db).toBeUndefined();
    });

    it('supports an ACL user, TLS and the command timeout', () => {
        const { options } = redisClientArgs({
            adapter: 'redis',
            connection: { host: 'redis.internal', username: 'app', password: 'pw', tls: true },
            commandTimeoutMs: 750,
        });
        expect(options).toMatchObject({ host: 'redis.internal', username: 'app', password: 'pw', tls: {} });
        expect(options.commandTimeout).toBe(750);
        expect(options.maxRetriesPerRequest).toBe(1);

        const withCa = redisClientArgs({ adapter: 'redis', connection: { tls: { servername: 'redis.internal' } } });
        expect(withCa.options.tls).toEqual({ servername: 'redis.internal' });
    });
});

describe('CacheFeature with Redis unreachable', () => {
    // Accepts connections and never answers: a hung Redis (failover, network
    // partition), where only the command timeout ends a request.
    let blackhole: TCPSocketListener<undefined>;
    const sockets: Socket<undefined>[] = [];

    beforeAll(() => {
        blackhole = Bun.listen({
            hostname: '127.0.0.1',
            port: 0,
            socket: { open: (s) => void sockets.push(s), data() {} },
        });
    });
    afterAll(() => {
        for (const s of sockets) s.end();
        blackhole.stop(true);
    });

    it('fails a command after commandTimeoutMs instead of hanging', async () => {
        const kernel = new Kernel({ logger: false });
        const cache = new CacheFeature({
            adapter: 'redis',
            connection: { host: '127.0.0.1', port: blackhole.port },
            commandTimeoutMs: 300,
        });
        kernel.registerFeature(cache);
        await kernel.initialize();

        const started = Date.now();
        await expect(cache.client.get('k')).rejects.toThrow();
        expect(Date.now() - started).toBeLessThan(2000);

        await kernel.shutdown().catch(() => {});
    });

    it('logs one warning per outage through the Kernel logger, without AUTH arguments', async () => {
        const { logger, entries } = recordingLogger();
        const kernel = new Kernel({ logger });
        // Nothing listens on port 1: every reconnect attempt fails.
        const cache = new CacheFeature({
            adapter: 'redis',
            connection: { host: '127.0.0.1', port: 1, password: 'hunter2' },
            commandTimeoutMs: 300,
        });
        kernel.registerFeature(cache);
        await kernel.initialize();

        await cache.client.get('k').catch(() => {});
        await Bun.sleep(300);
        const warnings = entries.filter((e) => e.level === 'warn' && e.message.includes('Redis'));
        expect(warnings).toHaveLength(1);
        expect(JSON.stringify(warnings[0].details ?? {})).not.toContain('hunter2');

        await kernel.shutdown().catch(() => {});
    });
});

describe('RateLimitFeature when the store fails', () => {
    const failing: CacheAdapter = {
        get: async () => {
            throw new Error('Connection is closed.');
        },
        set: async () => {},
        delete: async () => {},
        exists: async () => false,
        incrementWithTtl: async () => {
            throw new Error('Connection is closed.');
        },
    };

    async function setup(passOnStoreError?: boolean) {
        const { logger, entries } = recordingLogger();
        const kernel = new Kernel({ logger });
        kernel.registerFeature({ name: 'cache', client: failing, async initialize() {} } as Feature);
        kernel.registerFeature(
            new RateLimitFeature({ store: 'cache', max: 1, keyGenerator: () => 'k', passOnStoreError }),
        );
        await kernel.initialize();
        kernel.getApp().get('/x', (c) => c.text('ok'));
        return { kernel, app: kernel.getApp(), entries };
    }

    it('lets requests through by default and logs the error at most once a minute', async () => {
        const { kernel, app, entries } = await setup();
        for (let i = 0; i < 3; i++) {
            const res = await app.request('/x');
            expect(res.status).toBe(200);
            expect(res.headers.get('X-RateLimit-Limit')).toBeNull();
        }
        expect(entries.filter((e) => e.level === 'error' && e.message.includes('rate-limit'))).toHaveLength(1);
        await kernel.shutdown();
    });

    it('answers 503 with Retry-After with passOnStoreError: false', async () => {
        const { kernel, app } = await setup(false);
        const res = await app.request('/x');
        expect(res.status).toBe(503);
        expect(res.headers.get('Retry-After')).toBe('5');
        await kernel.shutdown();
    });
});
