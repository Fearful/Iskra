import { describe, expect, it } from 'bun:test';
import { KVManager } from '../src';
import { MemoryAdapter } from '../src/adapters/memory';
import { RedisAdapter } from '../src/adapters/redis';
import type { KVAdapter } from '../src/types';

// cache-kit's clear() recycled the adapter (disconnect + connect): on Redis
// that flushed nothing, and a reconnect failing during a blip left the shared
// adapter dead. Adapters now clear their keys explicitly.

function managerWith(adapter: KVAdapter, namespace?: string): KVManager {
    const kv = new KVManager({ namespace });
    (kv as unknown as { adapter: KVAdapter }).adapter = adapter;
    return kv;
}

/** The slice of ioredis that clear() uses, with SCAN's MATCH on a literal prefix. */
class FakeRedis {
    store = new Map<string, string>();
    options: { keyPrefix?: string } = {};
    flushed = false;
    patterns: string[] = [];

    async scan(cursor: string, _match: 'MATCH', pattern: string, _count: 'COUNT', count: number) {
        this.patterns.push(pattern);
        expect(pattern.endsWith('*')).toBe(true);
        const literal = pattern.slice(0, -1).replace(/\\(.)/g, '$1');
        const keys = [...this.store.keys()].filter((k) => k.startsWith(literal));
        const start = Number(cursor);
        const page = keys.slice(start, start + count);
        return [start + count >= keys.length ? '0' : String(start + count), page];
    }

    async del(...keys: string[]) {
        const prefix = this.options.keyPrefix ?? '';
        for (const k of keys) this.store.delete(prefix + k);
        return keys.length;
    }

    async flushdb() {
        this.flushed = true;
        this.store.clear();
    }
}

function redisWith(fake: FakeRedis, flushDb = false) {
    const adapter = new RedisAdapter({}, { flushDb });
    (adapter as unknown as { client: FakeRedis }).client = fake;
    return adapter;
}

describe('MemoryAdapter.clear()', () => {
    it('deletes the keys under a prefix, or all of them', async () => {
        const adapter = new MemoryAdapter();
        await adapter.set('app:a', 1, 60);
        await adapter.set('app:b', 2);
        await adapter.sadd('app:tags:t', 'a');
        await adapter.set('apple', 3);
        await adapter.clear('app:');
        expect([await adapter.has('app:a'), await adapter.has('app:b'), await adapter.has('app:tags:t')]).toEqual([
            false,
            false,
            false,
        ]);
        expect(await adapter.get<number>('apple')).toBe(3);
        await adapter.clear();
        expect(await adapter.has('apple')).toBe(false);
    });
});

describe('KVManager.clear()', () => {
    it("clears only the manager's namespace", async () => {
        const shared = new MemoryAdapter();
        const a = managerWith(shared, 'moduleA');
        const b = managerWith(shared, 'moduleB');
        await a.set('k', 1);
        await b.set('k', 2);
        await a.clear();
        expect(await a.has('k')).toBe(false);
        expect(await b.get<number>('k')).toBe(2);
    });

    it('fails for an adapter that cannot clear', async () => {
        const kv = managerWith({ id: 'custom' } as KVAdapter);
        await expect(kv.clear()).rejects.toThrow(/"custom" KV adapter does not support clear\(\)/);
    });
});

describe('RedisAdapter.clear()', () => {
    it('SCANs and DELs the keys under the prefix, escaping glob characters', async () => {
        const fake = new FakeRedis();
        for (const k of ['app:1', 'app:2', 'app*x', 'apple', 'other']) fake.store.set(k, '1');
        const adapter = redisWith(fake);
        await adapter.clear('app:');
        await adapter.clear('app*');
        expect(fake.patterns).toEqual(['app:*', 'app\\**']);
        expect([...fake.store.keys()].sort()).toEqual(['apple', 'other']);
        expect(fake.flushed).toBe(false);
    });

    it("scopes to ioredis' keyPrefix, which DEL adds again", async () => {
        const fake = new FakeRedis();
        fake.options.keyPrefix = 'svc:';
        for (const k of ['svc:a', 'svc:b', 'other:a']) fake.store.set(k, '1');
        await redisWith(fake).clear();
        expect([...fake.store.keys()]).toEqual(['other:a']);
    });

    it('refuses to empty the whole database unless flushDb is set', async () => {
        const fake = new FakeRedis();
        fake.store.set('someone-elses-key', '1');
        await expect(redisWith(fake).clear()).rejects.toThrow(/whole Redis database/);
        expect(fake.store.size).toBe(1);

        await redisWith(fake, true).clear();
        expect(fake.flushed).toBe(true);
    });
});
