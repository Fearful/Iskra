import { describe, expect, it } from 'bun:test';
import { Cache } from '../src';
import { MemoryAdapter } from '../src/memory-adapter';
import type { KVAdapter } from '../src/types';

/** Counts the adapter calls a Cache makes. */
function counting(adapter: KVAdapter) {
    const calls: Record<string, number> = {};
    const proxy = new Proxy(adapter, {
        get(target, prop, receiver) {
            const value = Reflect.get(target, prop, receiver);
            if (typeof value !== 'function') return value;
            return (...args: unknown[]) => {
                calls[String(prop)] = (calls[String(prop)] ?? 0) + 1;
                return value.apply(target, args);
            };
        },
    });
    return { adapter: proxy, calls };
}

/** An adapter without expiring sets: the Cache keeps its tag index as a JSON list. */
function withoutSets(inner = new MemoryAdapter()) {
    const adapter: KVAdapter = {
        id: 'plain',
        connect: () => inner.connect(),
        disconnect: () => inner.disconnect(),
        get: (k) => inner.get(k),
        set: (k, v, ttl) => inner.set(k, v, ttl),
        del: (k) => inner.del(k),
        has: (k) => inner.has(k),
    };
    return { adapter, inner };
}

describe('tag index', () => {
    // Each tagged set() read, parsed and rewrote the whole index: 40k tagged
    // sets took minutes, and expired keys stayed listed for good.
    it('adds a key to the index in one adapter call, whatever its size', async () => {
        const { adapter, calls } = counting(new MemoryAdapter());
        const cache = new Cache(adapter);
        for (let i = 0; i < 5000; i++) await cache.set(`item:${i}`, i, { ttl: 60, tags: ['items'] });
        expect(calls).toEqual({ set: 5000, sadd: 5000 });

        await cache.invalidateTag('items');
        expect(await cache.get('item:0')).toBeUndefined();
        expect(await cache.get('item:4999')).toBeUndefined();
    });

    it('lets the index expire with its entries', async () => {
        const adapter = new MemoryAdapter();
        const cache = new Cache(adapter);
        await cache.set('a', 1, { ttl: 0.03, tags: ['t'] });
        expect(await adapter.has('__cache_tags__:t')).toBe(true);
        await Bun.sleep(60);
        expect(await adapter.has('__cache_tags__:t')).toBe(false);
    });

    it('still drains an index written before 0.x', async () => {
        const adapter = new MemoryAdapter();
        const cache = new Cache(adapter);
        await cache.set('perm:1', ['admin']);
        await adapter.set('__cache_tag__:perms', JSON.stringify(['perm:1']));
        await cache.invalidateTag('perms');
        expect(await cache.get('perm:1')).toBeUndefined();
        expect(await adapter.has('__cache_tag__:perms')).toBe(false);
    });
});

describe('tag index without adapter sets (JSON list)', () => {
    it('drops expired keys and expires with its last entry', async () => {
        const { adapter, inner } = withoutSets();
        const cache = new Cache(adapter);
        await cache.set('old', 1, { ttl: 0.03, tags: ['t'] });
        await Bun.sleep(50);
        await cache.set('new', 2, { ttl: 0.2, tags: ['t'] });
        const list = JSON.parse((await inner.get<string>('__cache_tag__:t'))!) as Array<[string, number]>;
        expect(list.map(([key]) => key)).toEqual(['new']);
        await Bun.sleep(250);
        expect(await inner.has('__cache_tag__:t')).toBe(false);
    });

    it('stays bounded, deleting the oldest entries with it', async () => {
        const { adapter, inner } = withoutSets();
        const cache = new Cache(adapter);
        const full = Array.from({ length: 10_000 }, (_, i) => [`k${i}`, 0]);
        await inner.set('__cache_tag__:t', JSON.stringify(full));
        await cache.set('k0', 'oldest', { tags: [] });
        await cache.set('k1', 'second');
        await cache.set('newest', 'x', { tags: ['t'] });

        const list = JSON.parse((await inner.get<string>('__cache_tag__:t'))!) as Array<[string, number]>;
        expect(list).toHaveLength(10_000);
        expect(list[0]![0]).toBe('k1');
        expect(list.at(-1)![0]).toBe('newest');
        // Evicted from the index, so deleted: it can never escape an invalidation.
        expect(await cache.get('k0')).toBeUndefined();
        expect(await cache.get<string>('k1')).toBe('second');
    });
});

describe('reserved tag index keys', () => {
    // A caller-chosen key equal to "__cache_tag__:perms" overwrote the index,
    // and invalidateTag('perms') then deleted whatever keys it listed.
    it('refuses data keys and namespaces that reach the tag indexes', async () => {
        const cache = new Cache();
        for (const key of ['__cache_tag__:perms', '__cache_tags__:perms', 'users:__cache_tag__:perms']) {
            await expect(cache.set(key, ['session:admin'])).rejects.toThrow(/reserved for tag indexes/);
            await expect(cache.get(key)).rejects.toThrow(/reserved/);
            await expect(cache.has(key)).rejects.toThrow(/reserved/);
            await expect(cache.delete(key)).rejects.toThrow(/reserved/);
        }
        expect(() => cache.namespace('__cache_tag__')).toThrow(/reserved/);
        expect(() => new Cache(undefined, { namespace: 'a:__cache_tags__' })).toThrow(/reserved/);
        // Merely similar keys are fine.
        await cache.set('my__cache_tag__:x', 1);
        expect(await cache.get<number>('my__cache_tag__:x')).toBe(1);
    });

    it('never deletes a tag index listed as a key', async () => {
        const adapter = new MemoryAdapter();
        const cache = new Cache(adapter);
        await cache.set('perm:1', ['admin'], { tags: ['perms'] });
        // An old index naming the new one, as a pre-0.x writer could plant it.
        await adapter.set('__cache_tag__:other', JSON.stringify(['__cache_tags__:perms']));
        await cache.invalidateTag('other');
        await cache.invalidateTag('perms');
        expect(await cache.get('perm:1')).toBeUndefined();
    });
});
