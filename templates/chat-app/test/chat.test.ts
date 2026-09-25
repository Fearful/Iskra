import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { App } from '@iskra-bun/core';
import { KVManager } from '@iskra-bun/kv-kit';
import { SocketDriver } from '@iskra-bun/socket-kit';
import { issueToken } from '../src/auth';
import { createChat, MAX_AUTH_FAILURES, type Chat } from '../src/events';

const SECRET = 'a-test-secret-that-is-at-least-32-chars';

function freePort(): number {
    const probe = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() });
    const port = probe.port!;
    probe.stop(true);
    return port;
}

interface Frame {
    event: string;
    payload: any;
}

/** A WebSocket client that queues every frame it receives. */
async function connect(port: number) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const frames: Frame[] = [];
    const waiters: Array<() => void> = [];
    let closed: { code: number } | null = null;
    ws.addEventListener('message', (ev) => {
        frames.push(JSON.parse(String(ev.data)));
        waiters.splice(0).forEach((w) => w());
    });
    ws.addEventListener('close', (ev) => {
        closed = { code: ev.code };
        waiters.splice(0).forEach((w) => w());
    });
    await new Promise((resolve, reject) => {
        ws.addEventListener('open', resolve, { once: true });
        ws.addEventListener('error', reject, { once: true });
    });

    /** The next frame matching `match` (consumed), waiting up to 2 s for it. */
    const next = async (match: (f: Frame) => boolean): Promise<Frame> => {
        const deadline = Date.now() + 2000;
        for (;;) {
            const i = frames.findIndex(match);
            if (i >= 0) return frames.splice(i, 1)[0];
            if (Date.now() > deadline) throw new Error(`no matching frame; got ${JSON.stringify(frames)}`);
            await new Promise<void>((resolve) => {
                waiters.push(resolve);
                setTimeout(resolve, 50);
            });
        }
    };
    const request = async (event: string, payload: unknown = {}) => {
        ws.send(JSON.stringify({ event, payload }));
        return (await next((f) => f.event === `${event}:reply`)).payload;
    };
    return {
        ws,
        frames,
        next,
        request,
        closed: () => closed,
        signIn: (username: string) => request('auth', { token: issueToken(username, SECRET) }),
    };
}

const settle = () => new Promise((r) => setTimeout(r, 100));

describe('chat-app over a real SocketDriver', () => {
    let app: App;
    let kv: KVManager;
    let chat: Chat;
    let port: number;

    beforeAll(async () => {
        port = freePort();
        app = new App({
            name: 'ChatTest',
            logger: { level: 'error' },
            kv: { driver: 'memory' },
            shutdownSignals: false,
        });
        kv = new KVManager();
        // Same wiring as src/main.ts.
        chat = createChat(kv, { secret: SECRET, maxRooms: 3 });
        const socketDriver = new SocketDriver({
            port,
            router: chat.router,
            canJoin: chat.canJoin,
            canPublish: chat.canPublish,
        });
        app.register(kv);
        app.register(socketDriver);
        app.on('socket:disconnected', (ctx) =>
            chat.handleDisconnect(ctx.payload.connectionId, (topic, payload) =>
                socketDriver.broadcastTo(topic, topic, payload),
            ),
        );
        await app.start();
    });

    afterAll(async () => {
        await app.stop();
    });

    it('only lets authenticated sockets in, and only into rooms with a valid name', async () => {
        const anon = await connect(port);
        expect(await anon.request('join', { room: 'general' })).toMatchObject({ ok: false, error: 'unauthenticated' });

        expect(await anon.signIn('mallory')).toMatchObject({ ok: true, username: 'mallory' });
        // Up to 16 KiB of anything used to become a room (and a KV key).
        for (const room of ['x'.repeat(65), 'General', '../etc', 'a b', 42]) {
            expect(await anon.request('join', { room })).toMatchObject({ ok: false, error: 'invalid_room' });
        }
        anon.ws.close();
    });

    it('delivers a room message to its members only, through the room topic', async () => {
        const ana = await connect(port);
        const bob = await connect(port);
        const eve = await connect(port);
        await ana.signIn('ana');
        await bob.signIn('bob');
        await eve.signIn('eve');
        expect(await ana.request('join', { room: 'general' })).toMatchObject({ ok: true, room: 'general' });
        expect(await bob.request('join', { room: 'general' })).toMatchObject({ ok: true, members: ['ana', 'bob'] });
        expect(await eve.request('join', { room: 'random' })).toMatchObject({ ok: true });

        expect(await bob.request('message', { text: 'hola' })).toMatchObject({ ok: true });
        const seen = await ana.next((f) => f.event === 'room:general' && f.payload.type === 'message');
        expect(seen.payload).toMatchObject({ room: 'general', username: 'bob', text: 'hola' });
        // The sender gets it too (server-side publish), and #random nothing.
        await bob.next((f) => f.event === 'room:general' && f.payload.type === 'message');
        await settle();
        expect(eve.frames.filter((f) => f.event === 'room:general')).toEqual([]);

        for (const c of [ana, bob, eve]) c.ws.close();
    });

    it('gives the driver hooks a membership rule', async () => {
        const socket = (connectionId: string, subscribed: string[] = []) =>
            ({ data: { connectionId }, isSubscribed: (t: string) => subscribed.includes(t) }) as any;
        // Unknown (unauthenticated) connections can neither join nor publish.
        expect(chat.canJoin(socket('nobody'), 'room:general')).toBe(false);
        expect(chat.canPublish(socket('nobody', ['room:general']), 'room:general')).toBe(false);

        // An authenticated one joins public rooms with a valid name, and never the driver's `global`.
        const ws = socket('c-1', ['room:general']);
        await chat.router.getHandler('auth')!({
            socket: ws,
            payload: { token: issueToken('carol', SECRET) },
            reply: () => {},
            logger: app.logger,
        } as any);
        expect(chat.canJoin(ws, 'room:general')).toBe(true);
        expect(chat.canJoin(ws, 'global')).toBe(false);
        expect(chat.canJoin(ws, 'room:Not Valid')).toBe(false);
        // It publishes only to the room it is in (subscribed and joined), not to others.
        expect(chat.canPublish(ws, 'room:general')).toBe(false);
        expect(chat.canPublish(ws, 'global')).toBe(false);
        await chat.handleDisconnect('c-1', () => {});
    });

    it('caps message size', async () => {
        const ana = await connect(port);
        await ana.signIn('ana');
        await ana.request('join', { room: 'general' });
        expect(await ana.request('message', { text: 'é'.repeat(1025) })).toMatchObject({
            ok: false,
            error: 'message_too_long',
        });
        expect(await ana.request('message', { text: { not: 'a string' } })).toMatchObject({ ok: false });
        ana.ws.close();
    });

    it('caps the number of rooms and lists only joinable rooms, a page at a time', async () => {
        // A name stored before room names were validated (e.g. in Redis).
        await kv.set('rooms:index', ['general', 'random', 'x'.repeat(5000)]);
        const ana = await connect(port);
        await ana.signIn('ana');

        expect(await ana.request('join', { room: 'third' })).toMatchObject({ ok: true });
        expect(await ana.request('join', { room: 'fourth' })).toMatchObject({ ok: false, error: 'room_limit' });

        const page = await ana.request('rooms', { limit: 2 });
        expect(page).toMatchObject({ ok: true, rooms: ['general', 'random'], total: 3, nextOffset: 2 });
        expect(await ana.request('rooms', { offset: 2 })).toMatchObject({ rooms: ['third'], nextOffset: null });
        ana.ws.close();
    });

    it('closes a connection after repeated invalid tokens', async () => {
        const mallory = await connect(port);
        for (let i = 0; i < MAX_AUTH_FAILURES; i++) {
            expect(await mallory.request('auth', { token: `v1.ana.9999999999.forged${i}` })).toMatchObject({
                ok: false,
                error: 'invalid_token',
            });
        }
        await mallory.next(() => false).catch(() => {});
        expect(mallory.closed()).toEqual({ code: 1008 });
    });

    it('refuses to switch identity on an authenticated socket', async () => {
        const ana = await connect(port);
        await ana.signIn('ana');
        expect(await ana.signIn('bob')).toMatchObject({ ok: false, error: 'already_authenticated' });
        ana.ws.close();
    });

    it('removes a user from the room when the connection drops', async () => {
        await kv.set('room:general:members', []);
        const ana = await connect(port);
        const bob = await connect(port);
        await ana.signIn('ana');
        await bob.signIn('bob');
        await ana.request('join', { room: 'general' });
        await bob.request('join', { room: 'general' });

        bob.ws.close(); // no `leave`: the tab was closed
        const left = await ana.next((f) => f.event === 'room:general' && f.payload.left === 'bob');
        expect(left.payload.members).toEqual(['ana']);
        expect(await kv.get<string[]>('room:general:members')).toEqual(['ana']);
        ana.ws.close();
    });
});
