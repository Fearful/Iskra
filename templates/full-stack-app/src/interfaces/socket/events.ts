import { SocketRouter } from '@iskra-bun/socket-kit';
import type { KVManager } from '@iskra-bun/kv-kit';

/** Longest chat text that is stored and shown by GET /status. */
export const MAX_CHAT_TEXT = 500;

/** What GET /status shows as `last_chat`. */
export interface ChatMessage {
    text: string;
    receivedAt: string;
}

export function createSocketRouter(kv: KVManager): SocketRouter {
    const router = new SocketRouter();

    // Any client may send this, anonymously, and GET /status shows the result
    // to everyone: only a bounded text is kept, never the raw payload (which
    // could be any JSON up to the 16 KiB frame limit).
    router.on<{ text?: unknown }>('chat:message', async (ctx) => {
        const text = typeof ctx.payload?.text === 'string' ? ctx.payload.text.trim() : '';
        if (!text || text.length > MAX_CHAT_TEXT) {
            ctx.reply({ ok: false, error: `Send { "text": "..." } with 1 to ${MAX_CHAT_TEXT} characters` });
            return;
        }

        // One key, overwritten: the store never holds more than the last message.
        const message: ChatMessage = { text, receivedAt: new Date().toISOString() };
        await kv.set('last_message', message);
        ctx.logger.info({ length: text.length }, 'Chat message received');
        ctx.reply({ ok: true, message });
    });

    return router;
}
