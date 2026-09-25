import { describe, expect, it } from 'bun:test';
import { KVManager } from '../src';
import { MemoryAdapter } from '../src/adapters/memory';

// Expiring sets back cache-kit's tag index: each add is O(1), expired members
// are dropped, and the set itself expires with its last member.

describe('MemoryAdapter expiring sets', () => {
    it('drains the members added, once', async () => {
        const adapter = new MemoryAdapter();
        await adapter.sadd('tag', 'a', 60);
        await adapter.sadd('tag', 'b');
        await adapter.sadd('tag', 'a', 60);
        expect(await adapter.has('tag')).toBe(true);
        expect((await adapter.sdrain('tag')).sort()).toEqual(['a', 'b']);
        expect(await adapter.sdrain('tag')).toEqual([]);
        expect(await adapter.has('tag')).toBe(false);
    });

    it('expires with its longest-lived member', async () => {
        const adapter = new MemoryAdapter();
        await adapter.sadd('short', 'a', 0.03);
        await adapter.sadd('mixed', 'a', 0.03);
        await adapter.sadd('mixed', 'b', 0.2);
        await Bun.sleep(80);
        expect(await adapter.has('short')).toBe(false);
        // a expired, b did not.
        expect(await adapter.sdrain('mixed')).toEqual(['b']);
    });

    it('keeps a member for its longest TTL', async () => {
        const adapter = new MemoryAdapter();
        await adapter.sadd('tag', 'a', 0.2);
        // A later, shorter add must not drop it while the first write lives.
        await adapter.sadd('tag', 'a', 0.03);
        await Bun.sleep(80);
        expect(await adapter.sdrain('tag')).toEqual(['a']);
    });

    it('drops expired members as it grows', async () => {
        const adapter = new MemoryAdapter();
        for (let i = 0; i < 100; i++) await adapter.sadd('tag', `old:${i}`, 0.01);
        await Bun.sleep(30);
        for (let i = 0; i < 200; i++) await adapter.sadd('tag', `new:${i}`, 60);
        const members = (adapter as unknown as { sets: Map<string, { members: Map<string, number> }> }).sets.get(
            'tag',
        )!.members;
        expect([...members.keys()].some((m) => m.startsWith('old:'))).toBe(false);
        expect(members.size).toBe(200);
    });

    it('is namespaced by KVManager, members kept as given', async () => {
        const shared = new MemoryAdapter();
        const kv = new KVManager({ namespace: 'app' });
        (kv as unknown as { adapter: MemoryAdapter }).adapter = shared;
        await kv.sadd('tags:t', 'user:1');
        expect(await shared.has('app:tags:t')).toBe(true);
        expect(await kv.sdrain('tags:t')).toEqual(['user:1']);
    });
});
