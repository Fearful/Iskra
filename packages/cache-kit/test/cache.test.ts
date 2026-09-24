import { describe, it, expect, beforeEach } from 'bun:test';
import { Cache } from '../src';

// All tests use the default MemoryAdapter — no Redis, no network.

describe('Cache — basic CRUD', () => {
    let cache: Cache;

    beforeEach(() => {
        cache = new Cache();
    });

    it('get() returns undefined for a missing key', async () => {
        expect(await cache.get('nope')).toBeUndefined();
    });

    it('set() and get() round-trip a primitive', async () => {
        await cache.set('str', 'hello');
        expect(await cache.get<string>('str')).toBe('hello');
    });

    it('set() and get() round-trip an object', async () => {
        const obj = { id: 1, name: 'Alice', roles: ['admin'] };
        await cache.set('obj', obj);
        expect(await cache.get<typeof obj>('obj')).toEqual(obj);
    });

    it('set() and get() round-trip an array', async () => {
        const arr = [1, 'two', { three: 3 }];
        await cache.set('arr', arr);
        expect(await cache.get<typeof arr>('arr')).toEqual(arr);
    });

    it('has() returns true when the key exists', async () => {
        await cache.set('present', 42);
        expect(await cache.has('present')).toBe(true);
    });

    it('has() returns false for a missing key', async () => {
        expect(await cache.has('absent')).toBe(false);
    });

    it('delete() removes the key', async () => {
        await cache.set('bye', 'value');
        await cache.delete('bye');
        expect(await cache.has('bye')).toBe(false);
        expect(await cache.get('bye')).toBeUndefined();
    });

    it('delete() does not throw for a missing key', async () => {
        await cache.delete('ghost'); // must resolve without error
    });

    it('set() overwrites an existing key', async () => {
        await cache.set('k', 'first');
        await cache.set('k', 'second');
        expect(await cache.get<string>('k')).toBe('second');
    });

    it('clear() flushes all entries', async () => {
        await cache.set('a', 1);
        await cache.set('b', 2);
        await cache.clear();
        expect(await cache.has('a')).toBe(false);
        expect(await cache.has('b')).toBe(false);
    });
});

describe('Cache — TTL expiry', () => {
    let cache: Cache;

    beforeEach(() => {
        cache = new Cache();
    });

    it('value is present immediately after set with ttl', async () => {
        await cache.set('ttl-key', 'temp', { ttl: 1 });
        expect(await cache.get<string>('ttl-key')).toBe('temp');
    });

    it('value disappears after the TTL elapses', async () => {
        await cache.set('expire', 'soon', { ttl: 0.05 }); // 50 ms
        await new Promise((r) => setTimeout(r, 100));
        expect(await cache.get('expire')).toBeUndefined();
    });

    it('has() returns false after TTL elapses', async () => {
        await cache.set('ttl-has', 'v', { ttl: 0.05 }); // 50 ms
        await new Promise((r) => setTimeout(r, 100));
        expect(await cache.has('ttl-has')).toBe(false);
    });

    it('accepts a bare number as the shorthand for ttl seconds', async () => {
        await cache.set('shorthand', 99, 0.05); // 50 ms
        await new Promise((r) => setTimeout(r, 100));
        expect(await cache.get('shorthand')).toBeUndefined();
    });

    it('defaultTtl is applied when set() has no explicit ttl', async () => {
        const c = new Cache(undefined, { defaultTtl: 0.05 });
        await c.set('default-ttl', 'v');
        await new Promise((r) => setTimeout(r, 100));
        expect(await c.get('default-ttl')).toBeUndefined();
    });
});

describe('Cache — remember() / wrap()', () => {
    let cache: Cache;

    beforeEach(() => {
        cache = new Cache();
    });

    it('calls the fallback exactly once on a cache miss', async () => {
        let calls = 0;
        const result = await cache.remember('r', 60, async () => {
            calls++;
            return { data: 'fresh' };
        });

        expect(result).toEqual({ data: 'fresh' });
        expect(calls).toBe(1);
    });

    it('does NOT call the fallback on a subsequent hit', async () => {
        let calls = 0;
        const fallback = async () => { calls++; return 'value'; };

        await cache.remember('r2', 60, fallback);
        await cache.remember('r2', 60, fallback);
        await cache.remember('r2', 60, fallback);

        expect(calls).toBe(1); // fallback called exactly once
    });

    it('returns the cached value on repeated calls', async () => {
        await cache.set('hit', 'cached', 60);
        let calls = 0;
        const result = await cache.remember<string>('hit', 60, async () => {
            calls++;
            return 'fresh';
        });

        expect(result).toBe('cached');
        expect(calls).toBe(0);
    });

    it('stores the fallback result with the given ttl', async () => {
        await cache.remember('stored', 0.05, async () => 'ephemeral');
        await new Promise((r) => setTimeout(r, 100));
        expect(await cache.get('stored')).toBeUndefined();
    });

    it('wrap() is an alias for remember()', async () => {
        let calls = 0;
        const v1 = await cache.wrap('w', 60, async () => { calls++; return 'a'; });
        const v2 = await cache.wrap('w', 60, async () => { calls++; return 'b'; });

        expect(v1).toBe('a');
        expect(v2).toBe('a'); // returns cached
        expect(calls).toBe(1);
    });

    it('surfaces fallback errors with a descriptive message', async () => {
        const fn = () =>
            cache.remember('boom', 60, async () => {
                throw new Error('db unreachable');
            });

        await expect(fn()).rejects.toThrow('db unreachable');
    });
});

describe('Cache — namespace isolation', () => {
    let root: Cache;

    beforeEach(() => {
        root = new Cache();
    });

    it('namespaced sub-cache does not see root-level keys', async () => {
        await root.set('x', 'root');
        const ns = root.namespace('module-a');
        expect(await ns.get('x')).toBeUndefined();
    });

    it('two namespaces with the same key do not collide', async () => {
        const a = root.namespace('a');
        const b = root.namespace('b');

        await a.set('profile', { ns: 'a' });
        await b.set('profile', { ns: 'b' });

        expect(await a.get<{ ns: string }>('profile')).toEqual({ ns: 'a' });
        expect(await b.get<{ ns: string }>('profile')).toEqual({ ns: 'b' });
    });

    it('nested namespace() calls stack correctly', async () => {
        const ab = root.namespace('a').namespace('b');
        await ab.set('key', 'deep');
        expect(await ab.get<string>('key')).toBe('deep');
        // Root and single-level a must not see it
        expect(await root.get('key')).toBeUndefined();
        expect(await root.namespace('a').get('key')).toBeUndefined();
    });

    it('Cache.namespace() shares the same backing adapter', async () => {
        // A root set with the full prefixed key must be visible to the ns cache.
        const ns = root.namespace('shared');
        await ns.set('ping', 'pong');
        // The backing adapter stores the key as "shared:ping"
        // Root cache would see it only if queried as "shared:ping"
        expect(await ns.get<string>('ping')).toBe('pong');
    });
});

describe('Cache — tag-based invalidation', () => {
    let cache: Cache;

    beforeEach(() => {
        cache = new Cache();
    });

    it('invalidateTag() removes all entries with that tag', async () => {
        await cache.set('a', 1, { ttl: 60, tags: ['group'] });
        await cache.set('b', 2, { ttl: 60, tags: ['group'] });
        await cache.set('c', 3, { ttl: 60, tags: ['other'] });

        await cache.invalidateTag('group');

        expect(await cache.has('a')).toBe(false);
        expect(await cache.has('b')).toBe(false);
        expect(await cache.has('c')).toBe(true); // unaffected
    });

    it('invalidateTag() is a no-op for an unknown tag', async () => {
        // Must not throw
        await cache.invalidateTag('nonexistent-tag');
    });

    it('a single key can carry multiple tags', async () => {
        await cache.set('multi', 'v', { tags: ['t1', 't2'] });

        await cache.invalidateTag('t1');
        expect(await cache.has('multi')).toBe(false);
    });

    it('only the targeted tag is invalidated', async () => {
        await cache.set('keep', 'safe', { tags: ['alpha'] });
        await cache.set('drop', 'gone', { tags: ['beta'] });

        await cache.invalidateTag('beta');

        expect(await cache.has('keep')).toBe(true);
        expect(await cache.has('drop')).toBe(false);
    });
});
