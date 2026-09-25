import { describe, it, expect } from 'bun:test';
import { appendMessage, getMessages, addMember } from '../src/rooms';

/** A KV like kv-kit's: async, and values copied in and out. */
function memoryKv() {
    const store = new Map<string, unknown>();
    return {
        store,
        kv: {
            get: async (key: string) => structuredClone(store.get(key)),
            set: async (key: string, value: unknown) => void store.set(key, structuredClone(value)),
        } as any,
    };
}

describe('chat rooms', () => {
    it('keeps every message sent at the same time', async () => {
        const { kv } = memoryKv();
        await Promise.all(
            Array.from({ length: 10 }, (_, i) => appendMessage(kv, 'general', { username: `u${i}`, text: `m${i}` })),
        );
        // Each append read the same history and the last write won.
        expect((await getMessages(kv, 'general', { limit: 100 })).items).toHaveLength(10);
    });

    it('keeps every member joining at the same time', async () => {
        const { kv } = memoryKv();
        await Promise.all(['a', 'b', 'c'].map((u) => addMember(kv, 'general', u)));
        expect((await kv.get('room:general:members')).sort()).toEqual(['a', 'b', 'c']);
    });

    it('pages through messages that share a timestamp without skipping any', async () => {
        const { kv } = memoryKv();
        const realNow = Date.now;
        Date.now = () => 1000; // every message in the same millisecond
        try {
            for (let i = 1; i <= 5; i++) await appendMessage(kv, 'r', { username: 'u', text: `t${i}` });
        } finally {
            Date.now = realNow;
        }
        const seen: string[] = [];
        let before: number | undefined;
        for (let page = 0; page < 5; page++) {
            const result = await getMessages(kv, 'r', { before, limit: 2 });
            seen.unshift(...result.items.map((m) => m.text));
            if (!result.hasMore) break;
            before = result.nextBefore!;
        }
        // A time cursor skipped the rest of a millisecond after the first page.
        expect(seen).toEqual(['t1', 't2', 't3', 't4', 't5']);
    });
});
