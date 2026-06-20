/**
 * Codec consistency tests (RED stage).
 *
 * Covers audit finding: HIGH "redis codec corruption" (src/adapters/redis.ts:31).
 *
 * The MemoryAdapter preserves JS types exactly; the RedisAdapter must do the
 * same so the two are interchangeable. The current Redis `set` uses
 * `typeof value === 'object' ? JSON.stringify : String(value)`, which:
 *   - round-trips the STRING "123" back as the NUMBER 123, and
 *   - serializes `undefined` to the literal string "undefined".
 *
 * The fix is a single consistent codec: always JSON.stringify on write,
 * JSON.parse on read, with `undefined` guarded explicitly. These tests assert
 * the desired FIXED behavior and therefore fail against the current source.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { MemoryAdapter } from '../src/adapters/memory';
import { RedisAdapter } from '../src/adapters/redis';
import type { KVAdapter } from '../src/types';

// Minimal in-memory stand-in for the slice of ioredis the RedisAdapter touches.
class FakeRedis {
    store = new Map<string, string>();
    async get(key: string): Promise<string | null> {
        return this.store.has(key) ? this.store.get(key)! : null;
    }
    async set(key: string, value: string, ..._rest: unknown[]): Promise<'OK'> {
        this.store.set(key, value);
        return 'OK';
    }
    async del(key: string): Promise<number> {
        return this.store.delete(key) ? 1 : 0;
    }
    async exists(key: string): Promise<number> {
        return this.store.has(key) ? 1 : 0;
    }
    disconnect() {}
}

// Returns a RedisAdapter already wired to a fake client. We do NOT call the
// real connect() (it would `new Redis()` against a live server); the fake is
// injected directly, matching the pattern in redis.test.ts.
function makeRedis(): KVAdapter {
    const adapter = new RedisAdapter({});
    (adapter as unknown as { client: FakeRedis }).client = new FakeRedis();
    return adapter;
}

function makeMemory(): KVAdapter {
    const adapter = new MemoryAdapter();
    adapter.connect();
    return adapter;
}

// Run the same expectations against both adapters so interchangeability is
// asserted directly, not assumed.
const factories: Array<[string, () => KVAdapter]> = [
    ['MemoryAdapter', makeMemory],
    ['RedisAdapter', makeRedis],
];

for (const [name, make] of factories) {
    describe(`${name} — codec type fidelity`, () => {
        let adapter: KVAdapter;

        beforeEach(() => {
            adapter = make();
        });

        it('round-trips the string "123" as a string, not a number', async () => {
            await adapter.set('numeric-string', '123');
            const out = await adapter.get('numeric-string');
            expect(out).toBe('123');
            expect(typeof out).toBe('string');
        });

        it('round-trips a number as a number', async () => {
            await adapter.set('num', 123);
            const out = await adapter.get('num');
            expect(out).toBe(123);
            expect(typeof out).toBe('number');
        });

        it('round-trips a boolean as a boolean', async () => {
            await adapter.set('flag', true);
            const out = await adapter.get('flag');
            expect(out).toBe(true);
            expect(typeof out).toBe('boolean');
        });

        it('keeps objects intact', async () => {
            const obj = { a: 1, nested: { b: [2, 3] }, s: 'x' };
            await adapter.set('obj', obj);
            const out = await adapter.get<typeof obj>('obj');
            expect(out).toEqual(obj);
        });

        it('keeps arrays intact', async () => {
            const arr = [1, 'two', { three: 3 }];
            await adapter.set('arr', arr);
            const out = await adapter.get<typeof arr>('arr');
            expect(out).toEqual(arr);
        });

        it('does not corrupt undefined into the literal string "undefined"', async () => {
            await adapter.set('u', undefined);
            const out = await adapter.get('u');
            // Whatever the chosen semantics, it must NOT be the string "undefined".
            expect(out).not.toBe('undefined');
        });

        it('round-trips a string that looks like JSON without parsing it into an object', async () => {
            // "{}" is a string the user stored; it must come back as the string "{}".
            await adapter.set('json-ish', '{}');
            const out = await adapter.get('json-ish');
            expect(out).toBe('{}');
            expect(typeof out).toBe('string');
        });
    });
}
