import { describe, it, expect, afterAll } from 'bun:test';
import { App } from '@iskra-bun/core';
import { SocketDriver, SocketRouter } from '../src';

const PORT = 3597;

describe('SocketDriver – plain HTTP request', () => {
    const app = new App({ name: 'SocketPlainHttpTest', logger: { level: 'silent' } });
    app.register(new SocketDriver({ port: PORT, router: new SocketRouter() }));
    const started = app.start();

    afterAll(() => app.stop());

    it('answers 426 Upgrade Required, not a server error', async () => {
        // Regression: a GET without the WebSocket handshake got 500 "Upgrade
        // failed", so health checks against the socket port marked it down.
        await started;
        const res = await fetch(`http://127.0.0.1:${PORT}/`);
        expect(res.status).toBe(426);
        expect(res.headers.get('upgrade')).toBe('websocket');

        // A real client still connects.
        const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
        const opened = await new Promise<boolean>((resolve) => {
            ws.onopen = () => resolve(true);
            ws.onerror = () => resolve(false);
        });
        expect(opened).toBe(true);
        ws.close();
    });
});
