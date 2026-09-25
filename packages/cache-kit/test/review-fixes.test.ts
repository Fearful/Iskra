import { describe, it, expect } from 'bun:test';
import { Cache } from '../src';
import { MemoryAdapter } from '../src/memory-adapter';
import type { KVAdapter } from '../src/types';

/** An adapter whose reads and writes take a turn of the event loop, like Redis. */
function slowAdapter(): KVAdapter {
    const inner = new MemoryAdapter();
    const tick = () => new Promise((r) => setTimeout(r, 1));
    return {
        id: 'slow',
        connect: () => inner.connect(),
        disconnect: () => inner.disconnect(),
        get: async (k) => {
            await tick();
            return inner.get(k);
        },
        set: async (k, v, ttl) => {
            await tick();
            return inner.set(k, v, ttl);
        },
        del: async (k) => {
            await tick();
            return inner.del(k);
        },
        has: async (k) => {
            await tick();
            return inner.has(k);
        },
    } as KVAdapter;
}

describe('tag index', () => {
    it('keeps every key when entries with the same tag are set concurrently', async () => {
        const cache = new Cache(slowAdapter());
        await Promise.all(Array.from({ length: 10 }, (_, i) => cache.set(`item:${i}`, i, { tags: ['items'] })));
        await cache.invalidateTag('items');
        const left = await Promise.all(Array.from({ length: 10 }, (_, i) => cache.get(`item:${i}`)));
        // Concurrent read-modify-writes of the index used to lose all but one key.
        expect(left.filter((v) => v !== undefined)).toEqual([]);
    });
});

describe('prototype-pollution guard', () => {
    it('rejects an escaped __proto__ key', async () => {
        const adapter = new MemoryAdapter();
        const cache = new Cache(adapter);
        await adapter.set('evil', '{"a":{"\\u005f_proto__":{"polluted":true}}}');
        await expect(cache.get('evil')).rejects.toThrow(/unsafe key "__proto__"/);
        await adapter.set('evil2', '{"constructor":{"prototype":{"x":1}}}');
        await expect(cache.get('evil2')).rejects.toThrow(/unsafe key/);
    });
});

describe('remember()', () => {
    it('rethrows the fallback error itself and caches nothing', async () => {
        class NotFound extends Error {
            status = 404;
        }
        const cache = new Cache();
        const error = await cache
            .remember('k', 60, async () => {
                throw new NotFound('missing');
            })
            .catch((e) => e);
        expect(error).toBeInstanceOf(NotFound);
        expect(error.status).toBe(404);
        expect(await cache.has('k')).toBe(false);
    });
});

describe('TTLs', () => {
    it("keeps an entry whose TTL exceeds setTimeout's ~24.8-day limit", async () => {
        const cache = new Cache();
        await cache.set('long', 'v', { ttl: 30 * 24 * 3600 });
        await Bun.sleep(20);
        expect(await cache.get<string>('long')).toBe('v');
    });

    it('rejects a negative TTL', async () => {
        const cache = new Cache();
        await expect(cache.set('k', 'v', -1)).rejects.toThrow(RangeError);
    });
});
