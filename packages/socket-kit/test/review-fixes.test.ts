import { describe, it, expect } from 'bun:test';
import { App } from '@iskra-bun/core';
import { SocketDriver, SocketRouter } from '../src';

let nextPort = 3620;

async function startApp(router = new SocketRouter()) {
    const port = nextPort++;
    const app = new App({ name: 'SocketReview', logger: { level: 'silent' } });
    app.register(new SocketDriver({ port, router }));
    await app.start();
    return { app, port };
}

function open(port: number): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${port}`);
        ws.onopen = () => resolve(ws);
        ws.onerror = () => reject(new Error('connect failed'));
    });
}

describe('SocketDriver review fixes', () => {
    it('ignores a non-string event name (it bypassed the reserved-name check)', async () => {
        const { app, port } = await startApp();
        let disconnected = 0;
        app.on('socket:disconnected', () => {
            disconnected++;
        });
        const ws = await open(port);
        ws.send(JSON.stringify({ event: ['disconnected'] }));
        ws.send(JSON.stringify(['disconnected']));
        await Bun.sleep(100);
        expect(disconnected).toBe(0);
        ws.close();
        await Bun.sleep(50);
        expect(disconnected).toBe(1); // the real close still fires it
        await app.stop();
    });

    it('passes falsy payloads through unchanged', async () => {
        const router = new SocketRouter();
        router.on('echo', async (ctx) => ctx.reply(ctx.payload));
        const { app, port } = await startApp(router);
        const ws = await open(port);
        const replies: unknown[] = [];
        ws.onmessage = (e) => replies.push(JSON.parse(String(e.data)).payload);
        for (const payload of [0, false, '', undefined]) ws.send(JSON.stringify({ event: 'echo', payload }));
        await Bun.sleep(100);
        expect(replies).toEqual([0, false, '', {}]);
        ws.close();
        await app.stop();
    });

    it('closes open connections on stop', async () => {
        const router = new SocketRouter();
        router.on('ping', async (ctx) => ctx.reply('pong'));
        const { app, port } = await startApp(router);
        const ws = await open(port);
        const closed = new Promise<CloseEvent>((resolve) => {
            ws.onclose = (e) => resolve(e);
        });
        await app.stop();
        // A close frame, not a dropped connection (1006). Bun's client reports
        // the server's 1001 as 1000, so check the reason instead of the code.
        const event = await closed;
        expect(event.code).not.toBe(1006);
        expect(event.reason).toBe('Server shutting down');
    });
});
