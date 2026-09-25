/**
 * Native batch operation tests (RED stage).
 *
 * Covers audit finding: MEDIUM "batch N+1" (src/manager.ts:85).
 *
 * Desired fix:
 *   - The KVAdapter interface gains optional `mget?`, `mset?`, `mdel?`.
 *   - KVManager prefers the adapter's native batch method when present, and
 *     falls back to the per-key loop otherwise.
 *   - RedisAdapter implements native MGET / pipelined MSET / DEL.
 *
 * These tests assert the desired FIXED behavior and fail against current source
 * (RedisAdapter has no mget/mset/mdel; KVManager always loops).
 */
import { describe, it, expect } from 'bun:test';
import { KVManager } from '../src/manager';
import { RedisAdapter } from '../src/adapters/redis';
import type { KVAdapter } from '../src/types';

// ── RedisAdapter native batch methods ───────────────────────────────────────

// Fake ioredis client exposing mget + a pipeline for MSET and del.
class FakeRedis {
    store = new Map<string, string>();
    mgetCalls: string[][] = [];
    pipelineCalls = 0;

    async get(key: string): Promise<string | null> {
        return this.store.has(key) ? this.store.get(key)! : null;
    }
    async set(key: string, value: string, ..._rest: unknown[]): Promise<'OK'> {
        this.store.set(key, value);
        return 'OK';
    }
    async mget(...keys: string[]): Promise<(string | null)[]> {
        this.mgetCalls.push(keys);
        return keys.map((k) => (this.store.has(k) ? this.store.get(k)! : null));
    }
    async del(...keys: string[]): Promise<number> {
        let n = 0;
        for (const k of keys) if (this.store.delete(k)) n++;
        return n;
    }
    async exists(key: string): Promise<number> {
        return this.store.has(key) ? 1 : 0;
    }
    pipeline() {
        this.pipelineCalls++;
        const ops: Array<() => void> = [];
        const chain = {
            set: (key: string, value: string, ..._rest: unknown[]) => {
                ops.push(() => this.store.set(key, value));
                return chain;
            },
            exec: async () => {
                for (const op of ops) op();
                return [] as unknown[];
            },
        };
        return chain;
    }
    disconnect() {}
}

function makeRedis(): { adapter: RedisAdapter; fake: FakeRedis } {
    const adapter = new RedisAdapter({});
    const fake = new FakeRedis();
    (adapter as unknown as { client: FakeRedis }).client = fake;
    return { adapter, fake };
}

describe('RedisAdapter — native batch methods', () => {
    it('exposes mget, mset and mdel', () => {
        const { adapter } = makeRedis();
        expect(typeof (adapter as unknown as { mget?: unknown }).mget).toBe('function');
        expect(typeof (adapter as unknown as { mset?: unknown }).mset).toBe('function');
        expect(typeof (adapter as unknown as { mdel?: unknown }).mdel).toBe('function');
    });

    it('mget issues a single native MGET and preserves order with undefined for misses', async () => {
        const { adapter, fake } = makeRedis();
        await adapter.set('a', 1);
        await adapter.set('c', 3);

        const results = await (
            adapter as unknown as { mget: <T>(keys: string[]) => Promise<(T | undefined)[]> }
        ).mget<number>(['a', 'b', 'c']);

        expect(results).toEqual([1, undefined, 3]);
        // Exactly one round-trip, not one-per-key (no N+1).
        expect(fake.mgetCalls).toEqual([['a', 'b', 'c']]);
    });

    it('mset writes all entries through a single pipeline', async () => {
        const { adapter, fake } = makeRedis();

        await (
            adapter as unknown as {
                mset: <T>(entries: Array<[string, T]>, ttl?: number) => Promise<void>;
            }
        ).mset<number>([
            ['x', 10],
            ['y', 20],
        ]);

        expect(await adapter.get<number>('x')).toBe(10);
        expect(await adapter.get<number>('y')).toBe(20);
        expect(fake.pipelineCalls).toBe(1);
    });

    it('mdel removes all keys in a single DEL call', async () => {
        const { adapter, fake } = makeRedis();
        await adapter.set('d1', 'one');
        await adapter.set('d2', 'two');

        // Spy on del to confirm a single variadic call.
        const delCalls: string[][] = [];
        const origDel = fake.del.bind(fake);
        fake.del = async (...keys: string[]) => {
            delCalls.push(keys);
            return origDel(...keys);
        };

        await (adapter as unknown as { mdel: (keys: string[]) => Promise<void> }).mdel(['d1', 'd2']);

        expect(await adapter.get('d1')).toBeUndefined();
        expect(await adapter.get('d2')).toBeUndefined();
        expect(delCalls).toEqual([['d1', 'd2']]);
    });
});

// ── KVManager prefers native batch, else falls back ─────────────────────────

// Adapter that records whether its native batch methods were used.
class SpyBatchAdapter implements KVAdapter {
    id = 'spy';
    store = new Map<string, unknown>();
    mgetUsed = false;
    msetUsed = false;
    mdelUsed = false;

    connect() {}
    disconnect() {}
    async get<T = unknown>(key: string): Promise<T | undefined> {
        return this.store.get(key) as T | undefined;
    }
    async set<T = unknown>(key: string, value: T): Promise<void> {
        this.store.set(key, value);
    }
    async del(key: string): Promise<void> {
        this.store.delete(key);
    }
    async has(key: string): Promise<boolean> {
        return this.store.has(key);
    }
    async mget<T = unknown>(keys: string[]): Promise<(T | undefined)[]> {
        this.mgetUsed = true;
        return keys.map((k) => this.store.get(k) as T | undefined);
    }
    async mset<T = unknown>(entries: Array<[string, T]>): Promise<void> {
        this.msetUsed = true;
        for (const [k, v] of entries) this.store.set(k, v);
    }
    async mdel(keys: string[]): Promise<void> {
        this.mdelUsed = true;
        for (const k of keys) this.store.delete(k);
    }
}

function managerWith(adapter: KVAdapter, namespace?: string): KVManager {
    const mgr = new KVManager(namespace ? { namespace } : {});
    (mgr as unknown as { adapter: KVAdapter }).adapter = adapter;
    return mgr;
}

describe('KVManager — prefers native batch methods', () => {
    it('mget delegates to the adapter native mget when present', async () => {
        const spy = new SpyBatchAdapter();
        const kv = managerWith(spy);

        await kv.set('a', 1);
        await kv.set('b', 2);

        const results = await kv.mget<number>(['a', 'b']);
        expect(results).toEqual([1, 2]);
        expect(spy.mgetUsed).toBe(true);
    });

    it('mset delegates to the adapter native mset when present', async () => {
        const spy = new SpyBatchAdapter();
        const kv = managerWith(spy);

        await kv.mset<number>([
            ['x', 9],
            ['y', 8],
        ]);
        expect(spy.msetUsed).toBe(true);
        expect(await kv.get<number>('x')).toBe(9);
    });

    it('mdel delegates to the adapter native mdel when present', async () => {
        const spy = new SpyBatchAdapter();
        const kv = managerWith(spy);

        await kv.set('k', 1);
        await kv.mdel(['k']);
        expect(spy.mdelUsed).toBe(true);
        expect(await kv.get('k')).toBeUndefined();
    });

    it('native batch delegation still applies the namespace prefix to keys', async () => {
        const spy = new SpyBatchAdapter();
        const kv = managerWith(spy, 'ns');

        await kv.mset<number>([['p', 1]]);
        // The underlying adapter must see the prefixed key.
        expect(spy.store.has('ns:p')).toBe(true);
        expect(spy.store.has('p')).toBe(false);

        const results = await kv.mget<number>(['p']);
        expect(results).toEqual([1]);
    });
});
