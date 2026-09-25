import { describe, it, expect, afterEach } from 'bun:test';
import { App } from '@iskra-bun/core';
import { SocketDriver } from '../src';

function freePort(): number {
    const probe = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() });
    const port = probe.port!;
    probe.stop(true);
    return port;
}

describe('SocketDriver#close', () => {
    let app: App | undefined;

    afterEach(async () => {
        await app?.stop();
        app = undefined;
    });

    it('closes one connection by id, with the given code and reason', async () => {
        // For apps that authenticate in a message: without it they had no way
        // to close a connection that never did, and it stayed open.
        const port = freePort();
        app = new App({ name: 'SocketCloseTest', logger: { level: 'error' }, shutdownSignals: false });
        const driver = new SocketDriver({ port });
        const connected: string[] = [];
        app.on('socket:connected', (ctx) => {
            connected.push(ctx.payload.connectionId);
        });
        app.register(driver);
        await app.start();

        const ws = new WebSocket(`ws://127.0.0.1:${port}`);
        const closed = new Promise<{ code: number; reason: string }>((resolve) =>
            ws.addEventListener('close', (ev) => resolve({ code: ev.code, reason: ev.reason })),
        );
        await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
        for (let i = 0; i < 50 && connected.length === 0; i++) await Bun.sleep(10);

        expect(driver.close(connected[0], 1008, 'Authentication timeout')).toBe(true);
        expect(await closed).toEqual({ code: 1008, reason: 'Authentication timeout' });
        expect(driver.close(connected[0])).toBe(false);
        expect(driver.close('no-such-connection')).toBe(false);
    });
});
