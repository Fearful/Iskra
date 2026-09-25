import { describe, it, expect, mock } from 'bun:test';
import { App } from '../src/app';

describe('App Events', () => {
    it('should propagate context correctly', async () => {
        const app = new App({ name: 'ContextTest' });

        await new Promise<void>((resolve) => {
            app.on('msg', (ctx) => {
                expect(ctx.app).toBe(app);
                expect(ctx.logger).toBeDefined();
                expect(ctx.payload).toBe('data');
                resolve();
            });
            app.emit('msg', 'data');
        });
    });

    it('should support reply mechanism', async () => {
        const app = new App({ name: 'ReplyTest' });

        // Listener that replies
        app.on('ping', (ctx) => {
            ctx.reply('pong');
        });

        const replyPromise = new Promise((resolve) => {
            app.events.on('ping:reply', (data) => {
                expect(data).toBe('pong');
                resolve(true);
            });
        });

        app.emit('ping', {});
        await replyPromise;
    });

    it('should handle handler errors gracefully', async () => {
        const app = new App({ name: 'ErrorTest' });
        // We mock the logger to verify it catches the error
        const logSpy = mock(() => {});
        app.logger.error = logSpy;

        app.on('boom', () => {
            throw new Error('Explosion');
        });

        app.emit('boom', {});

        // Wait for async handler
        await new Promise((r) => setTimeout(r, 10));

        expect(logSpy).toHaveBeenCalled();
        const callArgs = logSpy.mock.calls[0] as unknown as [Record<string, any>, ...unknown[]];
        // pino logger.error({ err, event }, msg)
        expect(callArgs[0]).toHaveProperty('err');
        expect(callArgs[0].err.message).toBe('Explosion');
    });
});
