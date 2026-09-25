import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { App } from '@iskra-bun/core';
import { KVManager } from '@iskra-bun/kv-kit';
import { Cache } from '../src';

// A Cache on a KVManager with the Redis driver. Skipped when no Redis is
// reachable; point TEST_REDIS_URL at one to run it.
const REDIS_URL = process.env.TEST_REDIS_URL || 'redis://127.0.0.1:6379';

async function redisReachable(): Promise<boolean> {
    const probe = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null });
    probe.on('error', () => {});
    try {
        await probe.connect();
        return (await probe.ping()) === 'PONG';
    } catch {
        return false;
    } finally {
        probe.disconnect();
    }
}

const redisUp = await redisReachable();

describe.if(redisUp)('Cache on Redis (requires Redis)', () => {
    // Database 9, so the assertions only see this test's keys.
    const base = new URL(REDIS_URL);
    const url = `redis://${base.hostname}:${Number(base.port) || 6379}/9`;
    let raw: Redis;
    let app: App;
    let kv: KVManager;

    beforeAll(async () => {
        raw = new Redis(url);
        await raw.flushdb();
        app = new App({ name: 'CacheRedis', logger: { level: 'error' }, kv: { driver: 'redis', connection: url } });
        kv = new KVManager({ namespace: 'cache' });
        app.register(kv);
        await app.start();
    });

    afterAll(async () => {
        await app.stop();
        await raw.flushdb();
        raw.disconnect();
    });

    it("clear() deletes the cache's keys and leaves the rest of Redis alone", async () => {
        // Regression: clear() recycled the connection and deleted nothing.
        await raw.set('sessions:abc', 'keep');
        const cache = new Cache(kv);
        await cache.set('perm:1', ['admin'], { ttl: 300, tags: ['perms'] });
        await cache.namespace('users').set('1', 'Ana');
        expect((await raw.keys('cache:*')).length).toBe(3);

        await cache.clear();
        expect(await raw.keys('cache:*')).toEqual([]);
        expect(await raw.get('sessions:abc')).toBe('keep');
        expect(await cache.get('perm:1')).toBeUndefined();
        // The connection was never recycled.
        await cache.set('perm:1', ['viewer']);
        expect(await cache.get<string[]>('perm:1')).toEqual(['viewer']);
    });

    it('keeps the tag index as an expiring sorted set', async () => {
        const cache = new Cache(kv);
        await cache.set('a', 1, { ttl: 60, tags: ['t'] });
        await cache.set('b', 2, { ttl: 120, tags: ['t'] });
        expect(await raw.type('cache:__cache_tags__:t')).toBe('zset');
        expect(await raw.pttl('cache:__cache_tags__:t')).toBeGreaterThan(119_000);

        await cache.invalidateTag('t');
        expect(await raw.exists('cache:a', 'cache:b', 'cache:__cache_tags__:t')).toBe(0);
    });
});
