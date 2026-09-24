import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { App } from '@iskra-bun/core';
import { SocketDriver, SocketRouter } from '../src';

const PORT = 3591;
const ALLOWED = 'https://app.example.com';

/** Opens a socket (optionally with extra handshake headers) and resolves once it is open or refused. */
function connect(path = '', headers: Record<string, string> = {}): Promise<WebSocket | null> {
    return new Promise((resolve) => {
        const ws = new WebSocket(`ws://localhost:${PORT}${path}`, { headers } as unknown as string[]);
        ws.onopen = () => resolve(ws);
        ws.onerror = () => resolve(null);
        ws.onclose = () => resolve(null);
    });
}

function nextMessage(ws: WebSocket): Promise<any> {
    return new Promise((resolve) => {
        ws.onmessage = (e) => resolve(JSON.parse(String(e.data)));
    });
}

describe('SocketDriver handshake hardening', () => {
    let app: App;
    let lifecycleEvents = 0;

    beforeAll(async () => {
        app = new App({ name: 'SocketHandshakeTest' });
        app.on('socket:connected', () => {
            lifecycleEvents++;
        });

        const router = new SocketRouter();
        router.on('whoami', async (ctx) => ctx.reply({ auth: ctx.socket.data.auth }));

        app.register(
            new SocketDriver({
                port: PORT,
                router,
                allowedOrigins: [ALLOWED],
                authenticate: (req) => {
                    const token = new URL(req.url).searchParams.get('token');
                    return token === 'good' ? { userId: 'u1' } : null;
                },
            }),
        );
        await app.start();
    });

    afterAll(async () => {
        await app.stop();
    });

    it('refuses a handshake from a foreign Origin (cross-site WebSocket hijacking)', async () => {
        const res = await fetch(`http://localhost:${PORT}/?token=good`, {
            headers: {
                Origin: 'https://evil.example',
                Upgrade: 'websocket',
                Connection: 'Upgrade',
                'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
                'Sec-WebSocket-Version': '13',
            },
        });
        expect(res.status).toBe(403);
    });

    it('refuses a connection that authenticate() rejects', async () => {
        const res = await fetch(`http://localhost:${PORT}/?token=bad`, { headers: { Origin: ALLOWED } });
        expect(res.status).toBe(401);
        expect(await connect('/?token=bad', { Origin: ALLOWED })).toBeNull();
    });

    it('accepts an allowed origin with valid credentials and exposes the auth result', async () => {
        const ws = await connect('/?token=good', { Origin: ALLOWED });
        expect(ws).not.toBeNull();
        const reply = nextMessage(ws!);
        ws!.send(JSON.stringify({ event: 'whoami' }));
        expect((await reply).payload).toEqual({ auth: { userId: 'u1' } });
        ws!.close();
    });

    it('does not let a client fire the driver lifecycle events', async () => {
        const ws = await connect('/?token=good');
        await new Promise((r) => setTimeout(r, 30));
        const before = lifecycleEvents;

        // Regression: {event:"connected"} was forwarded as app event "socket:connected".
        ws!.send(JSON.stringify({ event: 'connected', payload: { forged: true } }));
        await new Promise((r) => setTimeout(r, 50));
        expect(lifecycleEvents).toBe(before);
        ws!.close();
    });
});
