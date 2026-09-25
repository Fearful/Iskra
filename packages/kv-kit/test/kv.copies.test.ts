import { describe, expect, it } from 'bun:test';
import { KVManager } from '../src';
import { MemoryAdapter } from '../src/adapters/memory';

// The memory adapter returned the stored object itself (Redis returns a copy),
// so a request that mutated what it read changed it for every later request.

describe('MemoryAdapter copies values in and out', () => {
    it('does not let a caller mutate the stored value', async () => {
        const adapter = new MemoryAdapter();
        const perms = { roles: ['viewer'], flags: { admin: false } };
        await adapter.set('perm:1', perms);

        // The caller's own object changes after set()...
        perms.roles.push('admin');
        // ...and a reader mutates what it got.
        const read = await adapter.get<typeof perms>('perm:1');
        read!.flags.admin = true;

        expect(await adapter.get<typeof perms>('perm:1')).toEqual({ roles: ['viewer'], flags: { admin: false } });
    });

    it('does the same through KVManager', async () => {
        const kv = new KVManager();
        await kv.set('cart', { items: [1] });
        (await kv.get<{ items: number[] }>('cart'))!.items.push(2);
        expect(await kv.get<{ items: number[] }>('cart')).toEqual({ items: [1] });
    });

    it('still keeps values JSON cannot represent', async () => {
        const adapter = new MemoryAdapter();
        const at = new Date('2026-01-01T00:00:00Z');
        await adapter.set('d', { at, tags: new Set(['a']) });
        const read = await adapter.get<{ at: Date; tags: Set<string> }>('d');
        expect(read!.at).toEqual(at);
        expect(read!.tags.has('a')).toBe(true);
    });
});
