import type { WebContext } from '@iskra-bun/web-kit';
import type { KVManager } from '@iskra-bun/kv-kit';
import type { DbDriver } from '@iskra-bun/db-kit';

export function createHttpRoutes(kv: KVManager, db: DbDriver) {
    return [
        {
            method: 'GET' as const,
            path: '/',
            handler: () => ({ message: 'Welcome to Iskra Full Stack App!' }),
            doc: { summary: 'Root endpoint' }
        },
        {
            method: 'GET' as const,
            path: '/status',
            handler: async (ctx: WebContext) => {
                const lastMsg = await kv.get('last_message');
                return {
                    uptime: process.uptime(),
                    workers: ctx.app.context.get('worker_last_ping'),
                    last_chat: lastMsg
                };
            },
            doc: { summary: 'Get app status' }
        },
        {
            method: 'GET' as const,
            path: '/db-test',
            handler: async () => {
                const ok = await db.ping();
                return { ok };
            },
            doc: { summary: 'Test DB connection' }
        }
    ];
}
