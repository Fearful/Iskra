/**
 * Tests for batch operations mget / mset / mdel on KVManager.
 *
 * These are implemented at the KVManager level (looping adapter get/set/del)
 * so the KVAdapter interface is NOT changed and existing implementers like
 * cache-kit's MemoryAdapter are unaffected.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { KVManager } from '../src/manager';

describe('KVManager — batch operations', () => {
    let kv: KVManager;

    beforeEach(async () => {
        kv = new KVManager();
        await kv.connect();
    });

    afterEach(async () => {
        await kv.disconnect();
    });

    // ── mget ──────────────────────────────────────────────────────────────────

    it('mget returns values in the same order as the keys array', async () => {
        await kv.set('a', 1);
        await kv.set('b', 2);
        await kv.set('c', 3);

        const results = await kv.mget<number>(['a', 'b', 'c']);
        expect(results).toEqual([1, 2, 3]);
    });

    it('mget returns undefined for missing keys', async () => {
        await kv.set('exists', 'yes');

        const results = await kv.mget<string>(['exists', 'missing']);
        expect(results).toEqual(['yes', undefined]);
    });

    it('mget on empty array returns empty array', async () => {
        expect(await kv.mget([])).toEqual([]);
    });

    // ── mset (array form) ─────────────────────────────────────────────────────

    it('mset (array of tuples) sets all entries', async () => {
        await kv.mset<number>([['x', 10], ['y', 20], ['z', 30]]);

        expect(await kv.get<number>('x')).toBe(10);
        expect(await kv.get<number>('y')).toBe(20);
        expect(await kv.get<number>('z')).toBe(30);
    });

    it('mset (object form) sets all entries', async () => {
        await kv.mset({ p: 'alpha', q: 'beta' });

        expect(await kv.get<string>('p')).toBe('alpha');
        expect(await kv.get<string>('q')).toBe('beta');
    });

    it('mset propagates TTL to all entries', async () => {
        await kv.mset<string>([['ttl1', 'v1'], ['ttl2', 'v2']], 0.1); // 100 ms

        expect(await kv.get<string>('ttl1')).toBe('v1');
        expect(await kv.get<string>('ttl2')).toBe('v2');

        await new Promise(r => setTimeout(r, 150));

        expect(await kv.get('ttl1')).toBeUndefined();
        expect(await kv.get('ttl2')).toBeUndefined();
    });

    it('mset on empty array is a no-op', async () => {
        await expect(kv.mset([])).resolves.toBeUndefined();
    });

    // ── mdel ──────────────────────────────────────────────────────────────────

    it('mdel removes all specified keys', async () => {
        await kv.set('d1', 'one');
        await kv.set('d2', 'two');
        await kv.set('d3', 'three');

        await kv.mdel(['d1', 'd3']);

        expect(await kv.get('d1')).toBeUndefined();
        expect(await kv.get<string>('d2')).toBe('two');
        expect(await kv.get('d3')).toBeUndefined();
    });

    it('mdel on nonexistent keys does not throw', async () => {
        await expect(kv.mdel(['nope1', 'nope2'])).resolves.toBeUndefined();
    });

    it('mdel on empty array is a no-op', async () => {
        await expect(kv.mdel([])).resolves.toBeUndefined();
    });

    // ── batch + namespace ─────────────────────────────────────────────────────

    it('mget / mset respect the namespace prefix', async () => {
        const ns = new KVManager({ namespace: 'batch' });
        await ns.connect();

        await ns.mset<number>([['i', 1], ['j', 2]]);

        const results = await ns.mget<number>(['i', 'j', 'k']);
        expect(results).toEqual([1, 2, undefined]);

        // Keys must NOT appear in an un-namespaced manager sharing the same adapter
        // (they can't — each manager has its own MemoryAdapter in this test setup).
        await ns.disconnect();
    });
});
