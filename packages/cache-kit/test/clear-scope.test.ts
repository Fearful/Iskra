/**
 * Tests for the clear() footgun fix (audit MEDIUM, src/cache.ts:119).
 *
 * Current behaviour: clear() disconnect()/connect()s the shared adapter and
 * nukes the WHOLE backing store, so clearing one namespaced sub-cache silently
 * flushes EVERY other namespace sharing the same adapter.
 *
 * The fix may take either of two accepted shapes:
 *   (a) clear() is scoped to the calling Cache's namespace (enumeration), OR
 *   (b) clear() is renamed/guarded so it THROWS when a namespace prefix is set
 *       (a flushAll-style whole-store reset is only allowed on a root cache).
 *
 * Both of these tests fail today for the right reason: clearing a namespaced
 * sub-cache currently destroys a sibling namespace's data.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { MemoryAdapter } from '../src/memory-adapter';
import { Cache } from '../src';

describe('Cache — clear() is namespace-scoped (or refuses to nuke siblings)', () => {
    let adapter: MemoryAdapter;
    let root: Cache;

    beforeEach(() => {
        adapter = new MemoryAdapter();
        adapter.connect();
        root = new Cache(adapter);
    });

    it('clearing one namespace leaves a sibling namespace intact', async () => {
        const users = root.namespace('users');
        const posts = root.namespace('posts');

        await users.set('1', { name: 'Alice' });
        await posts.set('1', { title: 'Hello' });

        let scopedClearThrew = false;
        try {
            await users.clear();
        } catch {
            // Accepted fix (b): clear() throws when a namespace prefix is set.
            scopedClearThrew = true;
        }

        // Regardless of which fix shape was chosen, the sibling namespace's
        // data MUST survive. Today it does not — the shared adapter is wiped.
        expect(await posts.get<{ title: string }>('1')).toEqual({ title: 'Hello' });

        if (!scopedClearThrew) {
            // Fix (a): scoped clear — the cleared namespace's own key is gone.
            expect(await users.get('1')).toBeUndefined();
        } else {
            // Fix (b): clear() refused; users' own data is therefore untouched.
            expect(await users.get<{ name: string }>('1')).toEqual({ name: 'Alice' });
        }
    });

    it('clearing a sub-cache does not destroy unrelated root-level keys', async () => {
        await root.set('root-key', 'keep-me');
        const ns = root.namespace('section');
        await ns.set('inner', 'value');

        try {
            await ns.clear();
        } catch {
            // Fix (b): throwing is acceptable when a prefix is set.
        }

        // The root-level key belongs to a different scope and must survive.
        expect(await root.get<string>('root-key')).toBe('keep-me');
    });
});
