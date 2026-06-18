import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { App } from '@iskra-bun/core';
import { KVManager } from '../src';
import { RedisAdapter } from '../src/adapters/redis';

// Real Redis exercise for the Redis adapter. Skipped when no Redis is reachable
// so the unit suite (memory adapter) stays infra-free. Override with TEST_REDIS_URL.
const REDIS_URL = process.env.TEST_REDIS_URL || 'redis://127.0.0.1:6379';

async function redisReachable(): Promise<boolean> {
    const url = new URL(REDIS_URL);
    return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 1000);
        Bun.connect({
            hostname: url.hostname,
            port: Number(url.port) || 6379,
            socket: {
                data() {},
                open(socket) {
                    clearTimeout(timer);
                    socket.end();
                    resolve(true);
                },
                connectError() {
                    clearTimeout(timer);
                    resolve(false);
                },
            },
        }).catch(() => {
            clearTimeout(timer);
            resolve(false);
        });
    });
}

function redisOptions() {
    const url = new URL(REDIS_URL);
    return { host: url.hostname, port: Number(url.port) || 6379 };
}

const redisUp = await redisReachable();

describe.if(redisUp)('RedisAdapter (requires Redis)', () => {
    const prefix = `kvtest:${Date.now()}:`;
    let adapter: RedisAdapter;

    beforeAll(() => {
        adapter = new RedisAdapter(redisOptions());
        adapter.connect();
    });

    afterAll(async () => {
        for (const k of ['obj', 'str', 'h', 'd', 'ttl']) {
            await adapter.del(prefix + k);
        }
        adapter.disconnect();
    });

    it('round-trips an object through JSON serialization', async () => {
        await adapter.set(prefix + 'obj', { a: 1, b: [2, 3] });
        expect(await adapter.get(prefix + 'obj')).toEqual({ a: 1, b: [2, 3] });
    });

    it('returns a non-JSON string value unchanged', async () => {
        await adapter.set(prefix + 'str', 'hello-world');
        expect(await adapter.get(prefix + 'str')).toBe('hello-world');
    });

    it('returns null for a missing key', async () => {
        expect(await adapter.get(prefix + 'missing')).toBeNull();
    });

    it('reports key existence with has()', async () => {
        await adapter.set(prefix + 'h', '1');
        expect(await adapter.has(prefix + 'h')).toBe(true);
        expect(await adapter.has(prefix + 'absent')).toBe(false);
    });

    it('deletes a key', async () => {
        await adapter.set(prefix + 'd', 'x');
        await adapter.del(prefix + 'd');
        expect(await adapter.has(prefix + 'd')).toBe(false);
    });

    it('applies a TTL on set', async () => {
        await adapter.set(prefix + 'ttl', 'temp', 60);
        expect(await adapter.get(prefix + 'ttl')).toBe('temp');
        expect(await adapter.has(prefix + 'ttl')).toBe(true);
    });
});

describe.if(redisUp)('KVManager with the Redis driver', () => {
    const key = `kvmgr:${Date.now()}`;
    let app: App;
    let kv: KVManager;

    beforeAll(async () => {
        app = new App({
            name: 'KVRedis',
            logger: { level: 'error' },
            kv: { driver: 'redis', connection: redisOptions() },
        });
        kv = new KVManager();
        app.register(kv);
        await app.start();
    });

    afterAll(async () => {
        await kv.del(key);
        await app.stop();
    });

    it('selects the Redis adapter and persists values to Redis', async () => {
        await kv.set(key, { ok: true });
        expect(await kv.get(key)).toEqual({ ok: true });
        expect(await kv.has(key)).toBe(true);
    });
});
