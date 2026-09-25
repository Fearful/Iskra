import { describe, it, expect } from 'bun:test';
import type { KVManager } from '@iskra-bun/kv-kit';
import { createSocketRouter, MAX_CHAT_TEXT } from '../src/interfaces/socket/events';

/** Sends `payload` as a chat:message and returns what was stored and replied. */
async function chat(payload: unknown) {
    const store = new Map<string, unknown>();
    const kv = { set: async (key: string, value: unknown) => void store.set(key, value) } as unknown as KVManager;
    const replies: unknown[] = [];
    await createSocketRouter(kv).getHandler('chat:message')!({
        payload,
        reply: (data: unknown) => replies.push(data),
        logger: { info: () => {} },
    } as any);
    return { stored: store.get('last_message'), reply: replies[0] };
}

describe('full-stack-app chat:message', () => {
    it('stores only a bounded text, not the raw payload', async () => {
        const { stored, reply } = await chat({ text: ' hola ', admin: true, blob: 'x'.repeat(10_000) });
        expect(stored).toEqual({ text: 'hola', receivedAt: expect.any(String) });
        expect(reply).toMatchObject({ ok: true });
    });

    it('rejects payloads that are not a short text', async () => {
        for (const payload of [{ text: 'x'.repeat(MAX_CHAT_TEXT + 1) }, { text: '' }, { text: 42 }, [1, 2], 'hola']) {
            const { stored, reply } = await chat(payload);
            // Any JSON up to 16 KiB used to be stored and shown by GET /status.
            expect(stored).toBeUndefined();
            expect(reply).toMatchObject({ ok: false });
        }
    });
});
