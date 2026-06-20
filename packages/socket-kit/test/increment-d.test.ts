/**
 * Increment D tests
 *
 * 1. Rooms / namespaces  — join/leave + broadcastTo
 * 2. socket:disconnected event
 * 3. Unique connection id in connected/disconnected payloads
 *
 * Deferred (not implemented): upgrade-time auth, RPC request-id correlation.
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { App } from '@iskra-bun/core';
import { SocketDriver, SocketRouter } from '../src';

// Use a port distinct from socket.test.ts (3567) to avoid conflicts.
const PORT = 3568;

describe('Increment D — rooms, disconnected event, unique connection id', () => {
    let app: App;
    let driver: SocketDriver;

    beforeAll(async () => {
        app = new App({ name: 'IncrementDTest' });

        const router = new SocketRouter();

        // Handler: subscribe the sender to a named room.
        router.on('room:join', async (ctx) => {
            const room = String(ctx.payload);
            ctx.join(room);
            ctx.reply({ joined: room });
        });

        // Handler: unsubscribe the sender from a named room.
        router.on('room:leave', async (ctx) => {
            const room = String(ctx.payload);
            ctx.leave(room);
            ctx.reply({ left: room });
        });

        driver = new SocketDriver({ port: PORT, router });
        app.register(driver);
        await app.start();
    });

    afterAll(async () => {
        await app.stop();
    });

    // ─── Helper ───────────────────────────────────────────────────────────────

    function connect(): Promise<WebSocket> {
        return new Promise((resolve) => {
            const ws = new WebSocket(`ws://localhost:${PORT}`);
            ws.onopen = () => resolve(ws);
        });
    }

    function waitFor(ws: WebSocket, predicate: (data: unknown) => boolean): Promise<unknown> {
        return new Promise((resolve) => {
            ws.addEventListener('message', function handler(event) {
                const data = JSON.parse(event.data.toString());
                if (predicate(data)) {
                    ws.removeEventListener('message', handler);
                    resolve(data);
                }
            });
        });
    }

    /**
     * Listen once to an app event via mitt's raw API, returning a promise that
     * resolves with the raw payload (not the wrapped Context). We bypass App.on
     * so we can unregister after the first fire.
     */
    function appOnce(event: string): Promise<unknown> {
        return new Promise((resolve) => {
            const handler = (payload: unknown) => {
                app.events.off(event, handler);
                resolve(payload);
            };
            app.events.on(event, handler);
        });
    }

    // ─── 1. Rooms ─────────────────────────────────────────────────────────────

    it('socket that joined room "A" receives broadcastTo("A", ...), a non-member does not', async () => {
        const member = await connect();
        const outsider = await connect();

        // Let both sockets settle on the server side.
        await new Promise(r => setTimeout(r, 50));

        // member joins room "A".
        const joinAck = waitFor(member, (d: any) => d.event === 'room:join:reply');
        member.send(JSON.stringify({ event: 'room:join', payload: 'A' }));
        await joinAck;

        // Collect messages received by outsider for 150 ms.
        const outsiderMessages: unknown[] = [];
        outsider.addEventListener('message', (evt) => {
            outsiderMessages.push(JSON.parse(evt.data.toString()));
        });

        // Collect the room broadcast on member.
        const roomMsg = waitFor(member, (d: any) => d.event === 'room-news');

        driver.broadcastTo('A', 'room-news', { text: 'hello room A' });

        const received = await roomMsg;
        expect((received as any).payload).toEqual({ text: 'hello room A' });

        // Give outsider extra time to receive something (it should not).
        await new Promise(r => setTimeout(r, 150));
        const roomNewsForOutsider = outsiderMessages.filter((m: any) => m.event === 'room-news');
        expect(roomNewsForOutsider).toHaveLength(0);

        member.close();
        outsider.close();
    });

    it('socket that left room "B" no longer receives broadcastTo("B", ...)', async () => {
        const ws = await connect();
        await new Promise(r => setTimeout(r, 50));

        // Join room B.
        const joinAck = waitFor(ws, (d: any) => d.event === 'room:join:reply');
        ws.send(JSON.stringify({ event: 'room:join', payload: 'B' }));
        await joinAck;

        // Leave room B.
        const leaveAck = waitFor(ws, (d: any) => d.event === 'room:leave:reply');
        ws.send(JSON.stringify({ event: 'room:leave', payload: 'B' }));
        await leaveAck;

        // Record messages after leaving.
        const received: unknown[] = [];
        ws.addEventListener('message', (evt) => {
            received.push(JSON.parse(evt.data.toString()));
        });

        driver.broadcastTo('B', 'should-not-arrive', { x: 1 });
        await new Promise(r => setTimeout(r, 150));

        expect(received.filter((m: any) => m.event === 'should-not-arrive')).toHaveLength(0);

        ws.close();
    });

    // ─── 2. socket:disconnected ───────────────────────────────────────────────

    it('emits socket:disconnected on the app event bus when a client closes', async () => {
        const ws = await connect();
        await new Promise(r => setTimeout(r, 50));

        const disconnectedPayload = appOnce('socket:disconnected');

        ws.close();

        const payload = await disconnectedPayload;
        expect(payload).toBeDefined();
        expect((payload as any).connectionId).toBeDefined();
    });

    // ─── 3. Unique connection id ──────────────────────────────────────────────

    it('socket:connected carries a stable unique connectionId (UUID v4 format)', async () => {
        const connectedPayload = appOnce('socket:connected');
        const ws = await connect();
        const payload = await connectedPayload;

        const { connectionId } = payload as any;
        expect(typeof connectionId).toBe('string');
        // UUID v4 pattern: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
        expect(connectionId).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
        );

        ws.close();
    });

    it('connected and disconnected events carry the SAME connectionId for a given socket', async () => {
        // Register connected listener first, then open the socket.
        const connectedPayload = appOnce('socket:connected');
        const ws = await connect();
        const connPayload = await connectedPayload;
        const connId = (connPayload as any).connectionId;

        // Now that we know this socket's id, register disconnected listener before closing.
        const disconnectedPayload = appOnce('socket:disconnected');
        ws.close();
        const disconnPayload = await disconnectedPayload;
        const disconnId = (disconnPayload as any).connectionId;

        expect(connId).toBe(disconnId);
    });

    it('each connection receives a distinct connectionId', async () => {
        const firstPayload = appOnce('socket:connected');
        const ws1 = await connect();
        const p1 = await firstPayload;

        const secondPayload = appOnce('socket:connected');
        const ws2 = await connect();
        const p2 = await secondPayload;

        const id1 = (p1 as any).connectionId;
        const id2 = (p2 as any).connectionId;

        expect(id1).toBeDefined();
        expect(id2).toBeDefined();
        expect(id1).not.toBe(id2);

        ws1.close();
        ws2.close();
    });
});
