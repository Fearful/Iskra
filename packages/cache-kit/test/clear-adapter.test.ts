import { describe, expect, it } from 'bun:test';
import { KVManager } from '@iskra-bun/kv-kit';
import { Cache } from '../src';
import { MemoryAdapter } from '../src/memory-adapter';
import type { KVAdapter } from '../src/types';

// clear() was disconnect() + connect() of the shared adapter: on Redis that
// deleted nothing (cached permissions stayed), every concurrent operation
// failed meanwhile, and a reconnect failing during a Redis blip left the
// adapter dead after Redis came back.

/** An adapter whose connection must never be recycled, recording clear() calls. */
function guardedAdapter() {
    const inner = new MemoryAdapter();
    const cleared: string[] = [];
    const adapter: KVAdapter = {
        id: 'guarded',
        connect: () => {
            throw new Error('connect() called: Redis is down');
        },
        disconnect: () => {
            throw new Error('disconnect() called on the shared adapter');
        },
        get: (k) => inner.get(k),
        set: (k, v, ttl) => inner.set(k, v, ttl),
        del: (k) => inner.del(k),
        has: (k) => inner.has(k),
        clear: async (prefix) => {
            cleared.push(prefix ?? '');
            await inner.clear(prefix);
        },
    };
    return { adapter, cleared };
}

describe('Cache.clear()', () => {
    it("clears through the adapter's clear(), never recycling its connection", async () => {
        const { adapter, cleared } = guardedAdapter();
        const cache = new Cache(adapter);
        await cache.set('perm:1', ['admin']);
        await cache.clear();
        expect(cleared).toEqual(['']);
        expect(await cache.has('perm:1')).toBe(false);
        // Still usable afterwards.
        await cache.set('perm:1', ['viewer']);
        expect(await cache.get<string[]>('perm:1')).toEqual(['viewer']);
    });

    it("clears a namespace's entries and tag indexes only", async () => {
        const root = new Cache();
        const users = root.namespace('users');
        const posts = root.namespace('posts');
        await users.set('1', 'alice', { tags: ['people'] });
        await users.namespace('admin').set('2', 'bob');
        await posts.set('1', 'hello', { tags: ['people'] });
        await root.set('users-count', 2);

        await users.clear();
        expect(await users.get('1')).toBeUndefined();
        expect(await users.namespace('admin').get('2')).toBeUndefined();
        expect(await posts.get<string>('1')).toBe('hello');
        expect(await root.get<number>('users-count')).toBe(2);
        await posts.invalidateTag('people');
        expect(await posts.get('1')).toBeUndefined();
    });

    it('fails when the adapter cannot clear', async () => {
        const { adapter } = guardedAdapter();
        delete adapter.clear;
        await expect(new Cache(adapter).clear()).rejects.toThrow(/"guarded" adapter cannot clear/);
    });

    it("clears only a KVManager's namespace", async () => {
        const kv = new KVManager({ namespace: 'cache' });
        const other = new KVManager({ namespace: 'sessions' });
        (other as unknown as { adapter: unknown }).adapter = (kv as unknown as { adapter: unknown }).adapter;
        await other.set('s1', 'token');
        const cache = new Cache(kv);
        await cache.set('k', 1);
        await cache.clear();
        expect(await cache.has('k')).toBe(false);
        expect(await other.get<string>('s1')).toBe('token');
    });
});
