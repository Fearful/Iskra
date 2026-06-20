/**
 * Tests for the prototype-pollution hardening on get() (audit LOW, src/cache.ts:67).
 *
 * get() deserialises stored values with JSON.parse(). If cache values can
 * originate from untrusted writers, a payload containing "__proto__" or
 * "constructor" keys can pollute Object.prototype the moment a caller deep-merges
 * the returned value. The fix must reject such keys during parse so the dangerous
 * payload never reaches application code.
 *
 * These tests fail today: JSON.parse() happily round-trips the malicious keys.
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

    it('throws when a stored value contains a "__proto__" key', async () => {
        // Simulate an untrusted writer storing a raw JSON string directly in the
        // backing adapter (bypassing set()'s JSON.stringify path).
        await adapter.set('evil', '{"__proto__":{"polluted":true}}');

        await expect(cache.get('evil')).rejects.toThrow();
    });

    it('throws when a stored value contains a nested "__proto__" key', async () => {
        await adapter.set('evil-nested', '{"a":{"__proto__":{"polluted":true}}}');

        await expect(cache.get('evil-nested')).rejects.toThrow();
    });

    it('throws when a stored value contains a "constructor" key', async () => {
        await adapter.set(
            'evil-ctor',
            '{"constructor":{"prototype":{"polluted":true}}}'
        );

        await expect(cache.get('evil-ctor')).rejects.toThrow();
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
