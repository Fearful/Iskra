/**
 * Shared-adapter namespace tests (RED stage).
 *
 * Covers audit finding: LOW "shared-adapter namespace test".
 *
 * The existing namespace tests give each KVManager its own MemoryAdapter, so a
 * prefix collision is structurally impossible and `prefixed()` is never truly
 * asserted. This injects ONE shared MemoryAdapter into two managers with
 * different namespaces and inspects the underlying store directly, proving the
 * prefix is actually written into the keys.
 *
 * This passes only once GREEN confirms KVManager writes `"<namespace>:<key>"`
 * to the shared adapter and the two namespaces stay distinct.
 */
import { describe, it, expect } from 'bun:test';
import { MemoryAdapter } from '../src/adapters/memory';
import { KVManager } from '../src/manager';
import type { KVAdapter } from '../src/types';

// Inject a specific adapter into a manager, bypassing init(app).
function managerWith(adapter: KVAdapter, namespace: string): KVManager {
    const mgr = new KVManager({ namespace });
    (mgr as unknown as { adapter: KVAdapter }).adapter = adapter;
    return mgr;
}

// Read the private store of a MemoryAdapter for white-box assertions.
function storeOf(adapter: MemoryAdapter): Map<string, unknown> {
    return (adapter as unknown as { store: Map<string, unknown> }).store;
}

describe('KVManager — shared adapter, distinct namespaces', () => {
    it('writes both namespaced keys distinctly into the one shared store', async () => {
        const shared = new MemoryAdapter();
        const a = managerWith(shared, 'moduleA');
        const b = managerWith(shared, 'moduleB');

        await a.set('config', { from: 'A' });
        await b.set('config', { from: 'B' });

        const store = storeOf(shared);
        expect(store.get('moduleA:config')).toEqual({ from: 'A' });
        expect(store.get('moduleB:config')).toEqual({ from: 'B' });
        // The un-prefixed key must NOT exist.
        expect(store.has('config')).toBe(false);
    });

    it('reads do not cross namespaces on a shared adapter', async () => {
        const shared = new MemoryAdapter();
        const a = managerWith(shared, 'moduleA');
        const b = managerWith(shared, 'moduleB');

        await a.set('config', { from: 'A' });
        await b.set('config', { from: 'B' });

        expect(await a.get<{ from: string }>('config')).toEqual({ from: 'A' });
        expect(await b.get<{ from: string }>('config')).toEqual({ from: 'B' });
    });

    it('del in one namespace leaves the other namespace key in the shared store', async () => {
        const shared = new MemoryAdapter();
        const a = managerWith(shared, 'moduleA');
        const b = managerWith(shared, 'moduleB');

        await a.set('config', 1);
        await b.set('config', 2);

        await a.del('config');

        const store = storeOf(shared);
        expect(store.has('moduleA:config')).toBe(false);
        expect(store.get('moduleB:config')).toBe(2);
    });
});
