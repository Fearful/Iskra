import { describe, it, expect, beforeEach } from 'bun:test';
import { RedisAdapter } from '../src/adapters/redis';
import type { KVAdapter } from '../src/types';

// In-memory stand-in for the slice of the ioredis client that RedisAdapter
// touches: get / set (with optional 'EX' ttl) / del / exists / disconnect.
// This lets us unit-test the adapter's serialization and TTL plumbing without
// a live Redis server. setCalls records raw arguments so we can assert that
// TTLs are forwarded as ('EX', seconds).
class FakeRedis {
    store = new Map<string, string>();
    setCalls: any[][] = [];
    disconnected = false;

    async get(key: string): Promise<string | null> {
        return this.store.has(key) ? this.store.get(key)! : null;
    }

    async set(key: string, value: string, ...rest: any[]): Promise<'OK'> {
        this.setCalls.push([key, value, ...rest]);
        this.store.set(key, value);
        return 'OK';
    }

    async del(key: string): Promise<number> {
        const existed = this.store.delete(key);
        return existed ? 1 : 0;
    }

    async exists(key: string): Promise<number> {
        return this.store.has(key) ? 1 : 0;
    }

    disconnect() {
        this.disconnected = true;
    }
}

// Build an adapter wired to a fake client, bypassing connect()/new Redis().
function makeAdapter(): { adapter: RedisAdapter; fake: FakeRedis } {
    const adapter = new RedisAdapter({});
    const fake = new FakeRedis();
    // The adapter only ever reaches for `this.client`; inject the fake directly.
    (adapter as unknown as { client: FakeRedis }).client = fake;
    return { adapter, fake };
}

describe('RedisAdapter', () => {
    let adapter: RedisAdapter;
    let fake: FakeRedis;

    beforeEach(() => {
        ({ adapter, fake } = makeAdapter());
    });

    it("declares the 'redis' adapter id and satisfies KVAdapter", () => {
        const asAdapter: KVAdapter = adapter;
        expect(asAdapter.id).toBe('redis');
    });

    it('stores and retrieves a primitive string value', async () => {
        await adapter.set('name', 'alice');
        expect(await adapter.get<string>('name')).toBe('alice');
    });

    it('serializes objects as JSON on set and parses them back on get', async () => {
        const obj = { a: 1, nested: { b: [2, 3] } };
        await adapter.set('obj', obj);
        // Stored form is the JSON string.
        expect(fake.store.get('obj')).toBe(JSON.stringify(obj));
        // Retrieved form is the parsed object.
        expect(await adapter.get<typeof obj>('obj')).toEqual(obj);
    });

    it('round-trips arrays through JSON', async () => {
        const arr = [1, 'two', { three: 3 }];
        await adapter.set('arr', arr);
        expect(await adapter.get<typeof arr>('arr')).toEqual(arr);
    });

    it('returns undefined for a missing key', async () => {
        expect(await adapter.get('nope')).toBeUndefined();
    });

    it('returns the raw string when stored value is not valid JSON', async () => {
        // Simulate a value written outside the adapter that is not JSON.
        fake.store.set('legacy', 'plain-text-not-json');
        expect(await adapter.get<string>('legacy')).toBe('plain-text-not-json');
    });

    it('passes EX ttl through to the client when a ttl is given', async () => {
        // Values are JSON-encoded on write, so the string "token" is stored as
        // its JSON form '"token"'. The assertion targets the EX/ttl plumbing.
        await adapter.set('session', 'token', 60);
        expect(fake.setCalls).toEqual([['session', JSON.stringify('token'), 'EX', 60]]);
    });

    it('omits the EX argument when no ttl is given', async () => {
        await adapter.set('perm', 'value');
        expect(fake.setCalls).toEqual([['perm', JSON.stringify('value')]]);
    });

    it('treats ttl of 0 as no expiry (falsy)', async () => {
        // The adapter guards with `if (ttl)`, so 0 must not add EX.
        await adapter.set('zero', 'v', 0);
        expect(fake.setCalls).toEqual([['zero', JSON.stringify('v')]]);
    });

    it('deletes a key', async () => {
        await adapter.set('temp', 'x');
        await adapter.del('temp');
        expect(await adapter.get('temp')).toBeUndefined();
    });

    it('does not throw when deleting a missing key', async () => {
        await adapter.del('ghost'); // should resolve without error
        expect(await adapter.get('ghost')).toBeUndefined();
    });

    it('has() returns true only when the key exists', async () => {
        await adapter.set('present', '1');
        expect(await adapter.has('present')).toBe(true);
        expect(await adapter.has('absent')).toBe(false);
    });

    it('disconnect() delegates to the client', () => {
        adapter.disconnect();
        expect(fake.disconnected).toBe(true);
    });

    it('disconnect() stops waiting for QUIT after quitTimeoutMs', async () => {
        const quitting = Object.assign(fake, {
            status: 'ready',
            quit: () => new Promise<never>(() => {}), // a QUIT that never answers
        });
        (adapter as unknown as { quitTimeoutMs: number }).quitTimeoutMs = 50;
        const started = Date.now();
        await adapter.disconnect();
        expect(Date.now() - started).toBeLessThan(1000);
        expect(quitting.disconnected).toBe(true);
    });

    it('disconnect() closes a client with Redis down at once, with commands pending', async () => {
        // Regression: QUIT was queued behind the offline queue, so disconnect()
        // (and KVManager.stop()) took ~10 s of reconnect attempts to return.
        const { default: Redis } = await import('ioredis');
        const probe = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {} } });
        const port = probe.port;
        probe.stop(true); // nothing listens on `port` any more
        const client = new Redis({ host: '127.0.0.1', port, lazyConnect: true });
        client.on('error', () => {});
        client.connect().catch(() => {});
        const pending = client.get('k').catch((e: Error) => e);
        const real = new RedisAdapter({});
        (real as unknown as { client: unknown }).client = client;

        const started = Date.now();
        await real.disconnect();
        expect(Date.now() - started).toBeLessThan(1000);
        expect(await pending).toBeInstanceOf(Error);
        expect(client.status).toBe('end');
    });

    it('serializes a number value via JSON and parses it back as a number', async () => {
        // JSON.stringify(42) === "42"; JSON.parse("42") yields the number 42.
        await adapter.set<number>('count', 42);
        expect(fake.store.get('count')).toBe('42');
        expect(await adapter.get<number>('count')).toBe(42);
    });
});

describe('kv-kit types (structural)', () => {
    it('RedisAdapter is assignable to the KVAdapter interface', () => {
        const a: KVAdapter = new RedisAdapter({});
        expect(typeof a.get).toBe('function');
        expect(typeof a.set).toBe('function');
        expect(typeof a.del).toBe('function');
        expect(typeof a.has).toBe('function');
        expect(typeof a.connect).toBe('function');
        expect(typeof a.disconnect).toBe('function');
    });
});
