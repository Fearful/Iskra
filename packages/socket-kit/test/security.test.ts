import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { App } from '@iskra-bun/core';
import { SocketDriver, SocketRouter } from '../src';

// RED-stage tests capturing the *fixed* behaviour for the socket-kit audit
// findings. They exercise the driver over a real WebSocket (matching the
// integration style in socket.test.ts) plus a couple of white-box assertions
// against the driver's Bun.serve config.

// ---------------------------------------------------------------------------
// HIGH — authz on join/publish (src/driver.ts:91/93)
// A canJoin/canPublish hook on the driver config must gate ctx.join and
// ctx.broadcast. When the hook denies a room/topic, the socket must NOT be
// subscribed to it and frames published to it must not be delivered.
// ---------------------------------------------------------------------------
describe('socket-kit authz hooks (HIGH driver.ts:91)', () => {
    let app: App;
    let driver: SocketDriver;
    const PORT = 3571;

    beforeAll(async () => {
        app = new App({ name: 'SocketAuthzTest' });

        const router = new SocketRouter();
        // Handler attempts to join a room straight from client input.
        router.on('join-room', async (ctx) => {
            ctx.join(String((ctx.payload as { room: string }).room));
            ctx.reply({ joined: (ctx.payload as { room: string }).room });
        });
        // Handler attempts to publish to a client-supplied topic.
        router.on('shout', async (ctx) => {
            const p = ctx.payload as { topic: string; msg: unknown };
            ctx.broadcast(p.topic, p.msg);
        });

        driver = new SocketDriver({
            port: PORT,
            router,
            // Only the room "public" may be joined; everything else (incl.
            // 'secret' and 'global') is denied.
            canJoin: (_connection: unknown, room: string) => room === 'public',
            // Only the topic "public" may be published to via ctx.broadcast;
            // everything else (incl. 'global') is denied.
            canPublish: (_connection: unknown, topic: string) => topic === 'public',
        } as unknown as ConstructorParameters<typeof SocketDriver>[0]);

        app.register(driver);
        await app.start();
    });

    afterAll(async () => {
        await app.stop();
    });

    it('does not deliver frames published to a room the publisher was denied join on', async () => {
        // A listener tries to join the private "secret" room (denied), so it
        // must never receive a broadcastTo on that room.
        const listener = new WebSocket(`ws://localhost:${PORT}`);
        await new Promise((resolve) => { listener.onopen = () => resolve(true); });
        await new Promise((r) => setTimeout(r, 50));

        let leaked = false;
        listener.onmessage = (event) => {
            const data = JSON.parse(event.data.toString());
            if (data.event === 'secret-news') leaked = true;
        };

        // Ask the server to subscribe us to the denied room.
        listener.send(JSON.stringify({ event: 'join-room', payload: { room: 'secret' } }));
        await new Promise((r) => setTimeout(r, 50));

        // Publish to the "secret" room. If authz worked, the listener was never
        // subscribed, so it must not see the frame.
        driver.broadcastTo('secret', 'secret-news', { classified: true });
        await new Promise((r) => setTimeout(r, 100));

        expect(leaked).toBe(false);
        listener.close();
    });

    it('rejects ctx.broadcast to an unauthorized topic (no frame delivered)', async () => {
        // The listener is auto-subscribed to 'global' at open(). canPublish
        // denies 'global', so a handler-driven ctx.broadcast('global', ...)
        // must NOT reach the listener. Without the gate, the frame is delivered
        // (this is what fails today).
        const listener = new WebSocket(`ws://localhost:${PORT}`);
        await new Promise((resolve) => { listener.onopen = () => resolve(true); });
        await new Promise((r) => setTimeout(r, 50));

        let spoofed = false;
        listener.onmessage = (event) => {
            const data = JSON.parse(event.data.toString());
            if (data.event === 'global') spoofed = true;
        };

        // Attacker triggers a publish to the denied 'global' topic via 'shout'.
        const attacker = new WebSocket(`ws://localhost:${PORT}`);
        await new Promise((resolve) => { attacker.onopen = () => resolve(true); });
        attacker.send(JSON.stringify({ event: 'shout', payload: { topic: 'global', msg: { hacked: true } } }));
        await new Promise((r) => setTimeout(r, 100));

        expect(spoofed).toBe(false);
        listener.close();
        attacker.close();
    });

    it('still allows joining and publishing to an authorized room', async () => {
        // Sanity: the authorized "public" room continues to work end-to-end via
        // the gated paths (ctx.join + ctx.broadcast), so the hook gates rather
        // than blocks everything.
        const listener = new WebSocket(`ws://localhost:${PORT}`);
        await new Promise((resolve) => { listener.onopen = () => resolve(true); });
        await new Promise((r) => setTimeout(r, 50));

        // Resolve with the frame payload, or with a sentinel after a short
        // grace period so a missing frame fails fast (rather than hanging).
        const newsPromise = new Promise((resolve) => {
            const timer = setTimeout(() => resolve('__timeout__'), 300);
            listener.onmessage = (event) => {
                const data = JSON.parse(event.data.toString());
                if (data.event === 'public') {
                    clearTimeout(timer);
                    resolve(data.payload);
                }
            };
        });

        // Listener joins the authorized 'public' room (allowed by canJoin).
        listener.send(JSON.stringify({ event: 'join-room', payload: { room: 'public' } }));
        await new Promise((r) => setTimeout(r, 50));

        // Publisher broadcasts to 'public' (allowed by canPublish) via ctx.broadcast.
        const publisher = new WebSocket(`ws://localhost:${PORT}`);
        await new Promise((resolve) => { publisher.onopen = () => resolve(true); });
        publisher.send(JSON.stringify({ event: 'shout', payload: { topic: 'public', msg: { ok: true } } }));

        expect(await newsPromise).toEqual({ ok: true });
        listener.close();
        publisher.close();
    });
});

// ---------------------------------------------------------------------------
// HIGH — payload limit / DoS (src/driver.ts:26)
// Bun.serve must be configured with a maxPayloadLength. We assert it via a
// white-box hook: the driver should expose the resolved limit so it is
// verifiable without sending a giant frame (which Bun would silently drop).
// ---------------------------------------------------------------------------
describe('socket-kit payload limit (HIGH driver.ts:26)', () => {
    it('configures maxPayloadLength on the Bun WebSocket server', async () => {
        const app = new App({ name: 'SocketLimitTest' });
        const driver = new SocketDriver({
            port: 3572,
            maxPayloadLength: 16 * 1024,
        } as unknown as ConstructorParameters<typeof SocketDriver>[0]);
        app.register(driver);
        await app.start();

        // The driver must surface the resolved websocket maxPayloadLength so we
        // can verify it is wired into Bun.serve. A finite positive limit is
        // required (unbounded JSON.parse is the vulnerability).
        const limit = (driver as unknown as { maxPayloadLength?: number }).maxPayloadLength;
        expect(typeof limit).toBe('number');
        expect(limit).toBe(16 * 1024);

        await app.stop();
    });

    it('applies a default maxPayloadLength even when none is supplied', async () => {
        const app = new App({ name: 'SocketLimitDefaultTest' });
        const driver = new SocketDriver({ port: 3573 });
        app.register(driver);
        await app.start();

        const limit = (driver as unknown as { maxPayloadLength?: number }).maxPayloadLength;
        expect(typeof limit).toBe('number');
        expect(limit).toBeGreaterThan(0);

        await app.stop();
    });
});

// ---------------------------------------------------------------------------
// HIGH — per-connection rate limit (src/driver.ts:26, DoS component)
// Beyond maxPayloadLength, the driver caps inbound messages per connection per
// window. Frames over the budget must be dropped (handler not invoked), while a
// fresh window resets the budget. This guards against a single socket flooding
// the message handler.
// ---------------------------------------------------------------------------
describe('socket-kit rate limit (HIGH driver.ts:26)', () => {
    let app: App;
    let driver: SocketDriver;
    let handled: number;
    const PORT = 3577;

    beforeAll(async () => {
        app = new App({ name: 'SocketRateTest' });
        const router = new SocketRouter();
        handled = 0;
        // Each accepted frame replies; counting replies proves the handler ran.
        router.on('tick', async (ctx) => {
            handled += 1;
            ctx.reply({ n: handled });
        });
        driver = new SocketDriver({
            port: PORT,
            router,
            // Tight budget so the test is fast and deterministic.
            rateLimit: 3,
            rateWindowMs: 200,
        } as unknown as ConstructorParameters<typeof SocketDriver>[0]);
        app.register(driver);
        await app.start();
    });

    afterAll(async () => {
        await app.stop();
    });

    it('drops frames once a connection exceeds its per-window budget', async () => {
        const ws = new WebSocket(`ws://localhost:${PORT}`);
        await new Promise((resolve) => { ws.onopen = () => resolve(true); });

        let replies = 0;
        ws.onmessage = () => { replies += 1; };

        // Fire 10 frames in a single burst; only the first 3 fit the budget.
        for (let i = 0; i < 10; i++) {
            ws.send(JSON.stringify({ event: 'tick', payload: { i } }));
        }
        await new Promise((r) => setTimeout(r, 100));

        // Handler ran at most rateLimit (3) times; excess frames were dropped.
        expect(handled).toBe(3);
        expect(replies).toBe(3);
        ws.close();
    });

    it('resets the budget after the rate window elapses', async () => {
        const ws = new WebSocket(`ws://localhost:${PORT}`);
        await new Promise((resolve) => { ws.onopen = () => resolve(true); });

        const before = handled;
        // Exhaust the budget.
        for (let i = 0; i < 5; i++) {
            ws.send(JSON.stringify({ event: 'tick', payload: { i } }));
        }
        await new Promise((r) => setTimeout(r, 50));
        expect(handled - before).toBe(3);

        // Wait past the window, then a fresh frame must be accepted again.
        await new Promise((r) => setTimeout(r, 250));
        ws.send(JSON.stringify({ event: 'tick', payload: { again: true } }));
        await new Promise((r) => setTimeout(r, 50));
        expect(handled - before).toBe(4);
        ws.close();
    });
});

// ---------------------------------------------------------------------------
// HIGH — ctx.broadcast envelope mismatch (src/driver.ts:92)
// ctx.broadcast must publish JSON.stringify({event: topic, payload: data}),
// matching driver.broadcast / broadcastTo. Currently it publishes raw data, so
// a subscriber receives an inconsistent frame.
// ---------------------------------------------------------------------------
describe('socket-kit ctx.broadcast envelope (HIGH driver.ts:92)', () => {
    let app: App;
    let driver: SocketDriver;
    const PORT = 3574;

    beforeAll(async () => {
        app = new App({ name: 'SocketEnvelopeTest' });
        const router = new SocketRouter();
        // Handler broadcasts a raw payload to the 'global' topic via ctx.broadcast.
        router.on('emit-news', async (ctx) => {
            ctx.broadcast('global', { headline: 'breaking' });
        });
        driver = new SocketDriver({ port: PORT, router });
        app.register(driver);
        await app.start();
    });

    afterAll(async () => {
        await app.stop();
    });

    it('wraps ctx.broadcast data in the {event, payload} envelope', async () => {
        const listener = new WebSocket(`ws://localhost:${PORT}`);
        await new Promise((resolve) => { listener.onopen = () => resolve(true); });
        await new Promise((r) => setTimeout(r, 50));

        const framePromise = new Promise<Record<string, unknown>>((resolve) => {
            listener.onmessage = (event) => {
                resolve(JSON.parse(event.data.toString()));
            };
        });

        const trigger = new WebSocket(`ws://localhost:${PORT}`);
        await new Promise((resolve) => { trigger.onopen = () => resolve(true); });
        trigger.send(JSON.stringify({ event: 'emit-news', payload: {} }));

        const frame = await framePromise;
        // The frame must match the driver.broadcast envelope: a top-level
        // `event` (the topic) and `payload` (the data), not the raw data.
        expect(frame.event).toBe('global');
        expect(frame.payload).toEqual({ headline: 'breaking' });

        listener.close();
        trigger.close();
    });
});

// ---------------------------------------------------------------------------
// LOW — fallback emit validates event names (src/driver.ts:96)
// Unmatched messages re-emit socket:<event>. After the fix, only events that
// pass validation (against a registered/allowed set) should be re-emitted;
// unknown/garbage event names must be dropped rather than blindly re-emitted.
// ---------------------------------------------------------------------------
describe('socket-kit fallback emit validation (LOW driver.ts:96)', () => {
    let app: App;
    let driver: SocketDriver;
    const PORT = 3575;

    beforeAll(async () => {
        app = new App({ name: 'SocketFallbackTest' });
        const router = new SocketRouter();
        driver = new SocketDriver({
            port: PORT,
            router,
            // Only this single fallback event name is permitted to re-emit.
            allowedEvents: ['known-event'],
        } as unknown as ConstructorParameters<typeof SocketDriver>[0]);
        app.register(driver);
        await app.start();
    });

    afterAll(async () => {
        await app.stop();
    });

    it('does not re-emit a fallback event that is not in the allowed set', async () => {
        let received = false;
        app.on('socket:__unlisted__', () => { received = true; });

        const ws = new WebSocket(`ws://localhost:${PORT}`);
        await new Promise((resolve) => { ws.onopen = () => resolve(true); });
        ws.send(JSON.stringify({ event: '__unlisted__', payload: { x: 1 } }));
        await new Promise((r) => setTimeout(r, 100));

        expect(received).toBe(false);
        ws.close();
    });

    it('still re-emits a fallback event that is in the allowed set', async () => {
        const eventPromise = new Promise((resolve) => {
            app.on('socket:known-event', (ctx) => resolve(ctx.payload));
        });

        const ws = new WebSocket(`ws://localhost:${PORT}`);
        await new Promise((resolve) => { ws.onopen = () => resolve(true); });
        ws.send(JSON.stringify({ event: 'known-event', payload: { ok: true } }));

        const received = await eventPromise;
        expect(received).toBeDefined();
        ws.close();
    });
});

// ---------------------------------------------------------------------------
// LOW — non-unique id on connect/disconnect (src/driver.ts:41)
// socket:connected/disconnected must no longer emit the misleading `id:
// ws.remoteAddress`. The payload should carry connectionId (and may carry
// remoteAddress), but not a non-unique `id` field.
// ---------------------------------------------------------------------------
describe('socket-kit connect payload id (LOW driver.ts:41)', () => {
    let app: App;
    let driver: SocketDriver;
    const PORT = 3576;

    beforeAll(async () => {
        app = new App({ name: 'SocketIdTest' });
        driver = new SocketDriver({ port: PORT });
        app.register(driver);
        await app.start();
    });

    afterAll(async () => {
        await app.stop();
    });

    it('emits socket:connected with connectionId but no non-unique id field', async () => {
        const connectedPromise = new Promise<Record<string, unknown>>((resolve) => {
            app.on('socket:connected', (ctx) => resolve(ctx.payload as Record<string, unknown>));
        });

        const ws = new WebSocket(`ws://localhost:${PORT}`);
        await new Promise((resolve) => { ws.onopen = () => resolve(true); });

        const payload = await connectedPromise;
        expect(payload.connectionId).toBeDefined();
        // The non-unique `id` (remoteAddress) must be dropped or renamed.
        expect('id' in payload).toBe(false);
        ws.close();
    });
});
