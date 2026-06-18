import { SocketRouter } from '@iskra-bun/socket-kit';
import type { KVManager } from '@iskra-bun/kv-kit';

export function createSocketRouter(kv: KVManager): SocketRouter {
    const router = new SocketRouter();

    router.on('chat:message', async (ctx) => {
        await kv.set('last_message', ctx.payload);
        ctx.logger.info({ msg: ctx.payload }, 'Chat message received');
        ctx.reply(ctx.payload);
    });

    return router;
}
