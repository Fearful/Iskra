import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { App, IskraError } from '@iskra-bun/core';
import { SocketDriver, SocketRouter, SocketConnectionError, SocketMessageError } from '../src';

describe('SocketKit', () => {
    let app: App;
    let driver: SocketDriver;
    const PORT = 3567;

    beforeAll(async () => {
        app = new App({ name: 'SocketTest' });

        const router = new SocketRouter();
        router.on('echo', async (ctx) => {
            ctx.reply(ctx.payload);
        });
        router.on('uppercase', async (ctx) => {
            ctx.reply(String(ctx.payload).toUpperCase());
        });
        router.on('announce', async (ctx) => {
            ctx.broadcast('global', ctx.payload);
        });

        driver = new SocketDriver({ port: PORT, router });
        app.register(driver);
        await app.start();
    });

    afterAll(async () => {
        await app.stop();
    });

    it('should connect and receive echo', async () => {
        const ws = new WebSocket(`ws://localhost:${PORT}`);

        const openPromise = new Promise(resolve => {
            ws.onopen = () => resolve(true);
        });
        await openPromise;

        const messagePromise = new Promise(resolve => {
            ws.onmessage = (event) => {
                const data = JSON.parse(event.data.toString());
                if (data.event === 'echo:reply') {
                    resolve(data.payload);
                }
            };
        });

        ws.send(JSON.stringify({ event: 'echo', payload: 'ping' }));

        const reply = await messagePromise;
        expect(reply).toBe('ping');
        ws.close();
    });

    it('should route to correct handler', async () => {
        const ws = new WebSocket(`ws://localhost:${PORT}`);
        await new Promise(resolve => { ws.onopen = () => resolve(true); });

        const messagePromise = new Promise(resolve => {
            ws.onmessage = (event) => {
                const data = JSON.parse(event.data.toString());
                if (data.event === 'uppercase:reply') {
                    resolve(data.payload);
                }
            };
        });

        ws.send(JSON.stringify({ event: 'uppercase', payload: 'hello' }));

        const reply = await messagePromise;
        expect(reply).toBe('HELLO');
        ws.close();
    });

    it('should handle complex payload objects', async () => {
        const ws = new WebSocket(`ws://localhost:${PORT}`);
        await new Promise(resolve => { ws.onopen = () => resolve(true); });

        const payload = { msg: 'test', nested: { a: 1 } };
        const messagePromise = new Promise(resolve => {
            ws.onmessage = (event) => {
                const data = JSON.parse(event.data.toString());
                if (data.event === 'echo:reply') {
                    resolve(data.payload);
                }
            };
        });

        ws.send(JSON.stringify({ event: 'echo', payload }));

        const reply = await messagePromise;
        expect(reply).toEqual(payload);
        ws.close();
    });

    it('should handle invalid JSON gracefully', async () => {
        const ws = new WebSocket(`ws://localhost:${PORT}`);
        await new Promise(resolve => { ws.onopen = () => resolve(true); });

        // Send invalid JSON — should not crash the server
        ws.send('not valid json {{{');

        // Wait a bit, then verify the server still accepts connections
        await new Promise(r => setTimeout(r, 100));

        const ws2 = new WebSocket(`ws://localhost:${PORT}`);
        const connected = new Promise(resolve => {
            ws2.onopen = () => resolve(true);
        });
        const result = await connected;
        expect(result).toBe(true);

        ws.close();
        ws2.close();
    });

    it('should emit socket:connected event on connection', async () => {
        const connectedPromise = new Promise(resolve => {
            app.on('socket:connected', (ctx) => {
                resolve(ctx.payload);
            });
        });

        const ws = new WebSocket(`ws://localhost:${PORT}`);
        await new Promise(resolve => { ws.onopen = () => resolve(true); });

        const payload = await connectedPromise;
        expect(payload).toBeDefined();
        ws.close();
    });

    it('should fallback to app event bus for unregistered events', async () => {
        const eventPromise = new Promise(resolve => {
            app.on('socket:custom-event', (ctx) => {
                resolve(ctx.payload);
            });
        });

        const ws = new WebSocket(`ws://localhost:${PORT}`);
        await new Promise(resolve => { ws.onopen = () => resolve(true); });

        ws.send(JSON.stringify({ event: 'custom-event', payload: { data: 'test' } }));

        const received = await eventPromise;
        expect(received).toBeDefined();
        ws.close();
    });

    it('ignores messages without an event field', async () => {
        const ws = new WebSocket(`ws://localhost:${PORT}`);
        await new Promise(resolve => { ws.onopen = () => resolve(true); });

        // No `event` key → handler returns early; server must stay healthy.
        ws.send(JSON.stringify({ payload: 'orphan' }));
        await new Promise(r => setTimeout(r, 100));

        const ws2 = new WebSocket(`ws://localhost:${PORT}`);
        const ok = await new Promise(resolve => { ws2.onopen = () => resolve(true); });
        expect(ok).toBe(true);
        ws.close();
        ws2.close();
    });

    it('broadcasts a message to all connected clients via driver.broadcast', async () => {
        const ws = new WebSocket(`ws://localhost:${PORT}`);
        await new Promise(resolve => { ws.onopen = () => resolve(true); });
        await new Promise(r => setTimeout(r, 50)); // let the server-side subscribe('global') settle

        const newsPromise = new Promise(resolve => {
            ws.onmessage = (event) => {
                const data = JSON.parse(event.data.toString());
                if (data.event === 'news') resolve(data.payload);
            };
        });

        driver.broadcast('news', { headline: 'hello' });

        expect(await newsPromise).toEqual({ headline: 'hello' });
        ws.close();
    });

    it('lets a router handler broadcast to a topic via ctx.broadcast', async () => {
        const ws = new WebSocket(`ws://localhost:${PORT}`);
        await new Promise(resolve => { ws.onopen = () => resolve(true); });
        await new Promise(r => setTimeout(r, 50));

        const announcePromise = new Promise(resolve => {
            ws.onmessage = (event) => {
                const data = JSON.parse(event.data.toString());
                // ctx.broadcast now wraps frames in the {event: topic, payload}
                // envelope, so the topic 'global' surfaces as data.event.
                if (data.event === 'global') resolve(data.payload);
            };
        });

        ws.send(JSON.stringify({ event: 'announce', payload: 'everyone listen' }));

        expect(await announcePromise).toBe('everyone listen');
        ws.close();
    });
});

describe('socket-kit error types', () => {
    it('SocketConnectionError carries the right code, name and cause', () => {
        const cause = new Error('handshake failed');
        const err = new SocketConnectionError('Connection refused', { cause, context: { port: 3001 } });
        expect(err).toBeInstanceOf(IskraError);
        expect(err.code).toBe('SOCKET_CONNECTION_ERROR');
        expect(err.name).toBe('SocketConnectionError');
        expect(err.cause).toBe(cause);
        expect(err.context).toEqual({ port: 3001 });
    });

    it('SocketMessageError carries the SOCKET_MESSAGE_ERROR code', () => {
        const err = new SocketMessageError('Bad frame');
        expect(err).toBeInstanceOf(IskraError);
        expect(err.code).toBe('SOCKET_MESSAGE_ERROR');
        expect(err.name).toBe('SocketMessageError');
    });
});
