import Redis from 'ioredis';
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

    beforeAll(async () => {
        adapter = new RedisAdapter(redisOptions());
        await adapter.connect();
    });

    afterAll(async () => {
        for (const k of ['obj', 'str', 'h', 'd', 'ttl']) {
            await adapter.del(prefix + k);
        }
        await adapter.disconnect();
    });

    it('round-trips an object through JSON serialization', async () => {
        await adapter.set(prefix + 'obj', { a: 1, b: [2, 3] });
        expect(await adapter.get<{ a: number; b: number[] }>(prefix + 'obj')).toEqual({ a: 1, b: [2, 3] });
    });

    it('returns a non-JSON string value unchanged', async () => {
        await adapter.set(prefix + 'str', 'hello-world');
        expect(await adapter.get<string>(prefix + 'str')).toBe('hello-world');
    });

    it('returns undefined for a missing key', async () => {
        expect(await adapter.get(prefix + 'missing')).toBeUndefined();
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
        expect(await adapter.get<string>(prefix + 'ttl')).toBe('temp');
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

    it('registers as "kv" in the app context and exposes the ioredis client', async () => {
        // forms-app's services read app.context.get('kv').client: it was
        // undefined, so they silently skipped every Redis write and read.
        expect(app.context.get('kv')).toBe(kv);
        const client = kv.client!;
        expect(client).toBeDefined();
        await client.sadd(`${key}:set`, 'a', 'b');
        expect((await client.smembers(`${key}:set`)).sort()).toEqual(['a', 'b']);
        await client.del(`${key}:set`);
    });

    it('selects the Redis adapter and persists values to Redis', async () => {
        await kv.set(key, { ok: true });
        expect(await kv.get<{ ok: boolean }>(key)).toEqual({ ok: true });
        expect(await kv.has(key)).toBe(true);
    });
});

describe.if(redisUp)('Redis connection settings (requires Redis)', () => {
    // Database 7 so the assertion can tell the URL apart from the default db 0.
    const base = new URL(REDIS_URL);
    const urlDb7 = `redis://${base.hostname}:${Number(base.port) || 6379}/7`;
    const key = `kvconn:${Date.now()}`;

    async function inDb(db: number): Promise<string | null> {
        const raw = new Redis({ ...redisOptions(), db });
        try {
            return await raw.get(key);
        } finally {
            raw.disconnect();
        }
    }

    it('honors { url } as documented for kv.connection', async () => {
        // Regression: ioredis ignored an object's `url`, so this connected to
        // localhost db 0 instead.
        const app = new App({
            name: 'KVUrl',
            logger: { level: 'error' },
            kv: { driver: 'redis', connection: { url: urlDb7 } },
        });
        const kv = new KVManager();
        app.register(kv);
        await app.start();
        try {
            await kv.set(key, 'in-db-7');
            expect(await inDb(7)).toBe(JSON.stringify('in-db-7'));
            expect(await inDb(0)).toBeNull();
        } finally {
            await kv.del(key);
            await app.stop();
        }
    });

    it('accepts a plain URL string', async () => {
        const adapter = new RedisAdapter(urlDb7);
        await adapter.connect();
        try {
            await adapter.set(key, 1);
            expect(await inDb(7)).toBe('1');
        } finally {
            await adapter.del(key);
            await adapter.disconnect();
        }
    });

    it('supports fractional TTLs (Redis EX only takes whole seconds)', async () => {
        const adapter = new RedisAdapter(urlDb7);
        await adapter.connect();
        try {
            await adapter.set(key, 'short', 0.2);
            await adapter.mset([[`${key}:b`, 'short']], 0.2);
            expect(await adapter.has(key)).toBe(true);
            await Bun.sleep(350);
            expect(await adapter.has(key)).toBe(false);
            expect(await adapter.has(`${key}:b`)).toBe(false);
        } finally {
            await adapter.disconnect();
        }
    });
});

describe('RedisAdapter / KVManager guards', () => {
    it('fails loudly when used before connect()', async () => {
        // Regression: `this.client?.set(...)` silently did nothing.
        const adapter = new RedisAdapter({});
        await expect(adapter.set('k', 'v')).rejects.toThrow(/not connected/);
        await expect(adapter.get('k')).rejects.toThrow(/not connected/);
    });

    it('has no native client with the memory driver', () => {
        const app = new App({ name: 'KVMem', logger: { level: 'error' } });
        const kv = new KVManager();
        kv.init(app);
        expect(app.context.get('kv')).toBe(kv);
        expect(kv.client).toBeUndefined();
    });

    it('rejects an unsupported driver instead of silently using memory', () => {
        const app = new App({ name: 'KVBad', logger: { level: 'error' }, kv: { driver: 'libsql' } as any });
        expect(() => new KVManager().init(app)).toThrow(/Unsupported KV driver "libsql"/);
    });
});
