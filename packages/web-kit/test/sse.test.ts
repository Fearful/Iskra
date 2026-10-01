import { afterEach, describe, expect, it } from 'bun:test';
import { Kernel } from '../src/kernel';
import { HealthCheckFeature } from '../src/features/health';
import { formatSseMessage, SseFeature, SseHub } from '../src/features/sse';
import { AuthFeature } from '../src/features/auth/index';
import { DbFeature } from '../src/features/db';
import type { KernelLogger } from '../src/logging';

interface Actor {
    id: string;
    team: string;
}

const ACTORS: Record<string, Actor> = {
    alice: { id: 'alice', team: 'red' },
    bob: { id: 'bob', team: 'blue' },
};

/** Sessions revoked since their client connected. */
const revoked = new Set<string>();

/** Identifies the client by the `x-user` header (an app would use AuthFeature). */
const actor = (c: { req: { header(name: string): string | undefined } }) => {
    const id = c.req.header('x-user') ?? '';
    return revoked.has(id) ? undefined : ACTORS[id];
};

function recordingLogger() {
    const warnings: string[] = [];
    const logger: KernelLogger = {
        debug: () => {},
        info: () => {},
        warn: (message) => warnings.push(message),
        error: () => {},
    };
    return { logger, warnings };
}

let kernels: Kernel[] = [];
let hubs: SseHub<Actor, unknown>[] = [];
afterEach(async () => {
    for (const kernel of kernels) await kernel.shutdown().catch(() => {});
    for (const hub of hubs) hub.close();
    kernels = [];
    hubs = [];
    revoked.clear();
});

async function setup(
    options: { heartbeatMs?: number; maxQueuedBytes?: number; idleTimeout?: number; maxConnectionMs?: number } = {},
) {
    const { logger, warnings } = recordingLogger();
    const kernel = new Kernel({ logger, idleTimeout: options.idleTimeout, port: 0, shutdownGraceMs: 3000 });
    const hub = new SseHub<Actor, unknown>({
        heartbeatMs: options.heartbeatMs ?? 60_000,
        maxQueuedBytes: options.maxQueuedBytes,
        maxConnectionMs: options.maxConnectionMs,
    });
    kernel.registerFeature(new HealthCheckFeature({ includeDetails: true }));
    kernel.registerFeature(new SseFeature({ hub, actor, maxClientsPerActor: 2 }));
    await kernel.initialize();
    hubs.push(hub);
    return { kernel, hub, app: kernel.getApp(), warnings };
}

/** Reads a text/event-stream block by block (each one ends with a blank line). */
function events(res: Response) {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    return {
        async next(timeoutMs = 1000): Promise<string> {
            const deadline = Date.now() + timeoutMs;
            while (!buffer.includes('\n\n')) {
                const remaining = deadline - Date.now();
                if (remaining <= 0) throw new Error(`no event within ${timeoutMs}ms`);
                const read = await Promise.race([reader.read(), Bun.sleep(remaining).then(() => null)]);
                if (read === null) continue;
                if (read.done) return '<closed>';
                buffer += decoder.decode(read.value, { stream: true });
            }
            const end = buffer.indexOf('\n\n');
            const block = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            return block;
        },
        cancel: () => reader.cancel(),
    };
}

const open = async (
    app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> },
    user: string,
    signal?: AbortSignal,
) => {
    const res = await app.request('/api/events', { headers: { 'x-user': user }, signal });
    expect(res.status).toBe(200);
    const stream = events(res);
    expect(await stream.next()).toBe(': connected');
    return stream;
};

describe('formatSseMessage', () => {
    it('writes the fields, JSON data and one data line per line', () => {
        expect(formatSseMessage({ event: 'card.moved', id: '7', data: { id: 1 } })).toBe(
            'event: card.moved\nid: 7\ndata: {"id":1}\n\n',
        );
        expect(formatSseMessage({ data: 'one\ntwo' })).toBe('data: one\ndata: two\n\n');
    });

    it('refuses a line break in the event name or id', () => {
        expect(() => formatSseMessage({ event: 'a\ndata: injected', data: 1 })).toThrow('line breaks');
        expect(() => formatSseMessage({ id: '1\r', data: 1 })).toThrow('line breaks');
    });
});

describe('SseFeature', () => {
    it('answers with the event-stream headers', async () => {
        const { app } = await setup();
        const res = await app.request('/api/events', { headers: { 'x-user': 'alice' } });
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
        expect(res.headers.get('cache-control')).toBe('no-cache');
        expect(res.headers.get('x-accel-buffering')).toBe('no');
        await res.body!.cancel();
    });

    it('answers 401 when no actor is identified', async () => {
        const { app, hub } = await setup();
        const res = await app.request('/api/events');
        expect(res.status).toBe(401);
        expect(hub.size).toBe(0);
    });

    it('refuses an actor without an id unless actorKey identifies it', async () => {
        const kernel = new Kernel({ logger: false });
        const hub = new SseHub<{ scopes: string[] }>();
        hubs.push(hub as unknown as SseHub<Actor, unknown>);
        kernel.registerFeature(new SseFeature({ hub, actor: () => ({ scopes: ['read'] }) }));
        await kernel.initialize();
        const res = await kernel.getApp().request('/api/events');
        expect(res.status).toBe(500);
        expect(hub.size).toBe(0);

        const keyed = new Kernel({ logger: false });
        const keyedHub = new SseHub<{ scopes: string[]; key: string }>();
        hubs.push(keyedHub as unknown as SseHub<Actor, unknown>);
        keyed.registerFeature(
            new SseFeature({ hub: keyedHub, actor: () => ({ scopes: ['read'], key: 'k1' }), actorKey: (a) => a.key }),
        );
        await keyed.initialize();
        const ok = await keyed.getApp().request('/api/events');
        expect(ok.status).toBe(200);
        expect(keyedHub.countOf('k1')).toBe(1);
        await ok.body!.cancel();
    });

    it('requires AuthFeature or an actor function', async () => {
        const kernel = new Kernel({ logger: false });
        kernel.registerFeature(new SseFeature({ hub: new SseHub() }));
        await expect(kernel.initialize()).rejects.toThrow('register AuthFeature or pass actor(c)');
    });

    it('sends each event only to the actors the filter accepts', async () => {
        const { app, hub } = await setup();
        const alice = await open(app, 'alice');
        const bob = await open(app, 'bob');

        expect(hub.publish({ event: 'card.moved', data: { card: 1 } }, (a) => a.team === 'red')).toBe(1);
        expect(hub.publish({ event: 'board.renamed', data: 'Sprint 3' })).toBe(2);

        expect(await alice.next()).toBe('event: card.moved\ndata: {"card":1}');
        expect(await alice.next()).toBe('event: board.renamed\ndata: Sprint 3');
        expect(await bob.next()).toBe('event: board.renamed\ndata: Sprint 3');
    });

    it('skips only the client whose filter throws', async () => {
        const { app, hub } = await setup();
        const alice = await open(app, 'alice');
        const bob = await open(app, 'bob');
        const sent = hub.publish({ data: 'x' }, (a) => {
            if (a.id === 'bob') throw new Error('boom');
            return true;
        });
        expect(sent).toBe(1);
        expect(await alice.next()).toBe('data: x');
        hub.publish({ data: 'y' });
        expect(await bob.next()).toBe('data: y');
    });

    it('lets an event through only when the filter returns true', async () => {
        const { app, hub } = await setup();
        const alice = await open(app, 'alice');
        const notTrue = [1, 'yes', {}, Promise.resolve(true), undefined] as unknown as boolean[];
        for (const verdict of notTrue) expect(hub.publish({ data: 'leak' }, () => verdict)).toBe(0);
        expect(hub.publish({ data: 'ok' }, () => true)).toBe(1);
        expect(await alice.next()).toBe('data: ok');
    });

    it('ends the connections of an actor with disconnect()', async () => {
        const { app, hub } = await setup();
        const alice = await open(app, 'alice');
        const bob = await open(app, 'bob');
        expect(hub.disconnect((a) => a.id === 'alice')).toBe(1);
        expect(await alice.next()).toBe('<closed>');
        expect(hub.size).toBe(1);
        hub.publish({ data: 'still here' });
        expect(await bob.next()).toBe('data: still here');
    });

    it('ends each connection within maxConnectionMs, so a revoked session is refused on reconnect', async () => {
        const { app, hub } = await setup({ maxConnectionMs: 200 });
        const alice = await open(app, 'alice');
        const started = Date.now();
        revoked.add('alice');
        hub.publish({ data: 'before the end' });
        expect(await alice.next()).toBe('data: before the end');
        expect(await alice.next(1000)).toBe('<closed>');
        const lasted = Date.now() - started;
        expect(lasted).toBeGreaterThanOrEqual(170);
        expect(lasted).toBeLessThan(600);
        expect(hub.size).toBe(0);
        // EventSource reconnects; the request is checked again.
        expect((await app.request('/api/events', { headers: { 'x-user': 'alice' } })).status).toBe(401);
    });

    it('sends the heartbeat', async () => {
        const { app } = await setup({ heartbeatMs: 20 });
        const alice = await open(app, 'alice');
        expect(await alice.next()).toBe(': ping');
        expect(await alice.next()).toBe(': ping');
    });

    it('drops a client when it disconnects or cancels the stream', async () => {
        const { app, hub } = await setup();
        const controller = new AbortController();
        await open(app, 'alice', controller.signal);
        const bob = await open(app, 'bob');
        expect(hub.size).toBe(2);

        controller.abort();
        expect(hub.size).toBe(1);
        await bob.cancel();
        expect(hub.size).toBe(0);
    });

    it('limits the connections of one actor', async () => {
        const { app } = await setup();
        await open(app, 'alice');
        await open(app, 'alice');
        const third = await app.request('/api/events', { headers: { 'x-user': 'alice' } });
        expect(third.status).toBe(429);
    });

    it('disconnects a client that falls too far behind', async () => {
        const { app, hub } = await setup({ maxQueuedBytes: 1024 });
        await app.request('/api/events', { headers: { 'x-user': 'alice' } }); // never read
        expect(hub.size).toBe(1);
        for (let i = 0; i < 10 && hub.size > 0; i++) hub.publish({ data: 'x'.repeat(400) });
        expect(hub.size).toBe(0);
    });

    it('reports the connected clients in /health', async () => {
        const { app } = await setup();
        await open(app, 'alice');
        const health = (await (await app.request('/health')).json()) as {
            customChecks: { sse: { status: string; details: { clients: number } } };
        };
        expect(health.customChecks.sse).toEqual({ status: 'ok', details: { clients: 1 } });
    });

    it('warns when the idle timeout cannot be lifted and is shorter than the heartbeat', async () => {
        const { app, warnings } = await setup({ heartbeatMs: 15_000, idleTimeout: 10 });
        await open(app, 'alice');
        await open(app, 'bob');
        expect(warnings.filter((w) => w.includes('idleTimeout'))).toHaveLength(1);

        // 10 s is checked in 4-second steps: it may close a connection after 8 s.
        const quiet = await setup({ heartbeatMs: 7_000, idleTimeout: 10 });
        await open(quiet.app, 'alice');
        expect(quiet.warnings.filter((w) => w.includes('idleTimeout'))).toHaveLength(0);
        const close = await setup({ heartbeatMs: 9_000, idleTimeout: 10 });
        await open(close.app, 'alice');
        expect(close.warnings.filter((w) => w.includes('idleTimeout'))).toHaveLength(1);
    });
});

describe('SseFeature on a running server', () => {
    it("keeps a connection open past Bun's idleTimeout", async () => {
        const { kernel, hub, warnings } = await setup({ heartbeatMs: 1500, idleTimeout: 1 });
        kernels.push(kernel);
        await kernel.start();
        const port = (kernel as unknown as { server: { port: number } }).server.port;

        const stream = events(await fetch(`http://localhost:${port}/api/events`, { headers: { 'x-user': 'alice' } }));
        expect(await stream.next()).toBe(': connected');
        // Bun checks idle connections every 4 s: past one full step, an
        // idleTimeout of 1 s has cut the stream unless it was lifted.
        const until = Date.now() + 4500;
        while (Date.now() < until) expect(await stream.next(2500)).toBe(': ping');
        hub.publish({ data: 'still here' });
        expect(await stream.next()).toBe('data: still here');
        expect(warnings.filter((w) => w.includes('idleTimeout'))).toHaveLength(0);
    }, 10_000);

    it('ends every connection on shutdown without waiting for the grace period', async () => {
        const { kernel, hub } = await setup();
        await kernel.start();
        const port = (kernel as unknown as { server: { port: number } }).server.port;
        const stream = events(await fetch(`http://localhost:${port}/api/events`, { headers: { 'x-user': 'alice' } }));
        expect(await stream.next()).toBe(': connected');
        hub.publish({ data: 'last' });

        const started = Date.now();
        await kernel.shutdown();
        expect(Date.now() - started).toBeLessThan(1000);
        expect(await stream.next()).toBe('data: last');
        expect(await stream.next()).toBe('<closed>');
        expect(hub.size).toBe(0);
        expect(hub.isClosed).toBe(true);
    });

    it('refuses new connections once shutting down', async () => {
        const { app, hub } = await setup();
        hub.close();
        const res = await app.request('/api/events', { headers: { 'x-user': 'alice' } });
        expect(res.status).toBe(503);
    });
});

describe('SseFeature with AuthFeature', () => {
    const DDL = `
CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT, email TEXT NOT NULL UNIQUE, emailVerified INTEGER NOT NULL, image TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
CREATE TABLE session (id TEXT PRIMARY KEY, expiresAt INTEGER NOT NULL, token TEXT NOT NULL UNIQUE, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, ipAddress TEXT, userAgent TEXT, userId TEXT NOT NULL REFERENCES user(id));
CREATE TABLE account (id TEXT PRIMARY KEY, accountId TEXT NOT NULL, providerId TEXT NOT NULL, userId TEXT NOT NULL REFERENCES user(id), accessToken TEXT, refreshToken TEXT, idToken TEXT, accessTokenExpiresAt INTEGER, refreshTokenExpiresAt INTEGER, scope TEXT, password TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
CREATE TABLE verification (id TEXT PRIMARY KEY, identifier TEXT NOT NULL, value TEXT NOT NULL, expiresAt INTEGER NOT NULL, createdAt INTEGER, updatedAt INTEGER);
`;
    const ORIGIN = 'http://localhost:3000';

    it('reads the session from the database, so a revoked one is refused on reconnect', async () => {
        const kernel = new Kernel({ logger: false });
        const db = new DbFeature({ adapter: 'sqlite', connection: { database: ':memory:' } });
        const hub = new SseHub();
        hubs.push(hub as unknown as SseHub<Actor, unknown>);
        kernel.registerFeature(db);
        kernel.registerFeature(
            new AuthFeature({
                secret: 'a-contract-secret-with-enough-entropy-1f9c2e7b',
                baseURL: ORIGIN,
                rateLimit: false,
            }),
        );
        kernel.registerFeature(new SseFeature({ hub }));
        await kernel.initialize();
        const sqlite = (db.db as unknown as { $client: { exec(sql: string): void } }).$client;
        sqlite.exec(DDL);
        const app = kernel.getApp();
        app.get('/me', (c) => c.json({ user: c.get('authUser') ? 'signed in' : null }));

        const signUp = await app.request('/api/sso/sign-up/email', {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: ORIGIN },
            body: JSON.stringify({ email: 'ana@example.com', password: 'password1234', name: 'Ana' }),
        });
        const cookie = signUp.headers
            .getSetCookie()
            .map((c) => c.split(';')[0])
            .join('; ');
        const first = await app.request('/api/events', { headers: { cookie } });
        expect(first.status).toBe(200);
        await first.body!.cancel();

        sqlite.exec('DELETE FROM session'); // revoked (sign-out elsewhere, an admin)
        // The cookie cache still lets it through on ordinary requests…
        expect(await (await app.request('/me', { headers: { cookie } })).json()).toEqual({ user: 'signed in' });
        // …but not on an SSE connection.
        expect((await app.request('/api/events', { headers: { cookie } })).status).toBe(401);
    });
});
