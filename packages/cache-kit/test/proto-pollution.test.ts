/**
 * Tests for the prototype-pollution hardening on get() (audit LOW, src/cache.ts:67).
 *
 * get() deserialises stored values with JSON.parse(). If cache values can
 * originate from untrusted writers, a payload containing "__proto__" or
 * "constructor" keys can pollute Object.prototype the moment a caller deep-merges
 * the returned value. The fix must reject such keys during parse so the dangerous
 * payload never reaches application code.
 *
 * Such a value reads as a miss (and is deleted): thrown, it failed every read
 * until the TTL ran out, and remember() never refetched.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { MemoryAdapter } from '../src/memory-adapter';
import { Cache } from '../src';

describe('Cache — get() rejects prototype-pollution payloads', () => {
    let adapter: MemoryAdapter;
    let cache: Cache;

    beforeEach(() => {
        adapter = new MemoryAdapter();
        adapter.connect();
        cache = new Cache(adapter);
    });

    it('reads a stored value with a "__proto__" key as a miss, and deletes it', async () => {
        // Simulate an untrusted writer storing a raw JSON string directly in the
        // backing adapter (bypassing set()'s JSON.stringify path).
        await adapter.set('evil', '{"__proto__":{"polluted":true}}');

        expect(await cache.get('evil')).toBeUndefined();
        expect(await adapter.has('evil')).toBe(false);
    });

    it('reads a stored value with a nested "__proto__" key as a miss', async () => {
        await adapter.set('evil-nested', '{"a":{"__proto__":{"polluted":true}}}');

        expect(await cache.get('evil-nested')).toBeUndefined();
    });

    it('reads a stored value with a "constructor" key as a miss', async () => {
        await adapter.set('evil-ctor', '{"constructor":{"prototype":{"polluted":true}}}');

        expect(await cache.get('evil-ctor')).toBeUndefined();
    });

    it('does NOT pollute Object.prototype when a malicious value is read', async () => {
        await adapter.set('evil2', '{"__proto__":{"isAdmin":true}}');

        try {
            await cache.get('evil2');
        } catch {
            // Rejecting the payload is the desired behaviour.
        }

        // No matter what, the global prototype must remain clean.
        expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
        expect((Object.prototype as Record<string, unknown>).isAdmin).toBeUndefined();
    });

    it('still round-trips a legitimate object that has no dangerous keys', async () => {
        const safe = { id: 1, name: 'Alice', nested: { ok: true } };
        await cache.set('safe', safe);
        expect(await cache.get<typeof safe>('safe')).toEqual(safe);
    });
});

// A cached object with a user-supplied `constructor` key was stored fine, then
// every get()/remember() threw until the TTL ran out (never, without one), and
// remember() never refetched.
describe('Cache — a polluted value is a miss, not an error', () => {
    it('lets remember() refetch instead of throwing', async () => {
        const adapter = new MemoryAdapter();
        const cache = new Cache(adapter);
        await adapter.set('profile:1', '{"name":"Ana","constructor":"engineer"}');

        let calls = 0;
        const fetchProfile = async () => {
            calls++;
            return { name: 'Ana', role: 'engineer' };
        };
        expect(await cache.remember('profile:1', 0, fetchProfile)).toEqual({ name: 'Ana', role: 'engineer' });
        expect(await cache.remember('profile:1', 0, fetchProfile)).toEqual({ name: 'Ana', role: 'engineer' });
        expect(calls).toBe(1);
    });

    it('stores nothing for a value it could not return, and drops the old one', async () => {
        const cache = new Cache();
        await cache.set('user:1', { name: 'Ana' });
        await cache.set('user:1', { name: 'Ana', constructor: 'user input' });
        expect(await cache.has('user:1')).toBe(false);
        expect(await cache.get('user:1')).toBeUndefined();

        const fromInput = JSON.parse('{"prototype":{"x":1}}');
        expect(await cache.remember('user:2', 0, async () => fromInput)).toEqual(fromInput);
        expect(await cache.has('user:2')).toBe(false);
    });
});
