import type { Context, Hono } from 'hono';
import type { Feature, Kernel } from '../types';
import { consoleLogger, type KernelLogger } from '../logging';
import { AuthError, HttpError } from '../errors';

/** One server-sent event. */
export interface SseMessage<T = unknown> {
    /** The event's name (`event:`), for `addEventListener(name)`; without one it is a `message`. */
    event?: string;
    /** Sent as is when a string, as JSON otherwise. */
    data: T;
    /** `id:`, which the browser sends back as `Last-Event-ID` when it reconnects. */
    id?: string;
}

export interface SseHubOptions {
    /**
     * How often a comment line is sent to every client, in ms (default
     * 15 000): it keeps proxies from closing a quiet connection and finds the
     * clients that are gone.
     */
    heartbeatMs?: number;
    /**
     * Bytes a client may have waiting to be sent (default 1 MiB). A client
     * that falls further behind is disconnected instead of growing the
     * server's memory; its browser reconnects.
     */
    maxQueuedBytes?: number;
    /** `retry:` sent on connect: how long the browser waits to reconnect, in ms. */
    retryMs?: number;
}

/** Decides, per connected actor, whether an event reaches it. */
export type SseFilter<A> = (actor: A) => boolean;

interface Client<A> {
    actor: A;
    key: string;
    controller: ReadableStreamDefaultController<Uint8Array>;
    closed: boolean;
}

const encoder = new TextEncoder();
const HEARTBEAT = encoder.encode(': ping\n\n');

function checkField(name: string, value: string): string {
    if (/[\r\n]/.test(value)) throw new Error(`SSE ${name} must not contain line breaks`);
    return value;
}

/** `message` in the text/event-stream format, ending with the blank line. */
export function formatSseMessage(message: SseMessage): string {
    const lines: string[] = [];
    if (message.event !== undefined) lines.push(`event: ${checkField('event', message.event)}`);
    if (message.id !== undefined) lines.push(`id: ${checkField('id', message.id)}`);
    const data = typeof message.data === 'string' ? message.data : (JSON.stringify(message.data) ?? '');
    for (const line of data.split(/\r\n|\r|\n/)) lines.push(`data: ${line}`);
    return `${lines.join('\n')}\n\n`;
}

/**
 * The connected SSE clients of this process, each with its actor (the user,
 * an API key…), and what is sent to them. In memory: with several instances
 * of the app, each one reaches only its own clients.
 *
 * ```ts
 * const hub = new SseHub<User, BoardEvent>();
 * new SseFeature({ path: '/api/events', hub });
 * hub.publish({ event: 'card.moved', data: card }, (user) => canSee(user, card));
 * ```
 */
export class SseHub<A = unknown, T = unknown> {
    readonly heartbeatMs: number;
    /** Where filter errors and dropped clients are reported; SseFeature sets the kernel's. */
    logger: KernelLogger = consoleLogger;
    private readonly maxQueuedBytes: number;
    private readonly retryMs?: number;
    private readonly clients = new Set<Client<A>>();
    private heartbeat?: ReturnType<typeof setInterval>;
    private closed = false;

    constructor(options: SseHubOptions = {}) {
        this.heartbeatMs = options.heartbeatMs ?? 15_000;
        this.maxQueuedBytes = options.maxQueuedBytes ?? 1024 * 1024;
        this.retryMs = options.retryMs;
        if (!(this.heartbeatMs > 0)) throw new Error('SseHub: heartbeatMs must be positive');
        if (!(this.maxQueuedBytes > 0)) throw new Error('SseHub: maxQueuedBytes must be positive');
    }

    /** Connected clients. */
    get size(): number {
        return this.clients.size;
    }

    /** Connected clients with the given actor key (see SseFeature's `actorKey`). */
    countOf(key: string): number {
        let count = 0;
        for (const client of this.clients) if (client.key === key) count++;
        return count;
    }

    /** Whether `close()` ran: no client can connect any more. */
    get isClosed(): boolean {
        return this.closed;
    }

    /**
     * Sends `message` to every client whose actor `filter` accepts (all of
     * them without one) and returns how many it was queued for. A filter that
     * throws skips that client only.
     */
    publish(message: SseMessage<T>, filter?: SseFilter<A>): number {
        const chunk = encoder.encode(formatSseMessage(message));
        let sent = 0;
        for (const client of [...this.clients]) {
            if (filter) {
                let visible: boolean;
                try {
                    visible = filter(client.actor);
                } catch (err) {
                    this.logger.error('SSE filter failed; the event was not sent to that client', err);
                    continue;
                }
                if (!visible) continue;
            }
            if (this.write(client, chunk)) sent++;
        }
        return sent;
    }

    /**
     * A stream for a new client of `actor`, to answer its request with. It
     * leaves the hub when `signal` aborts (the client went away), when the
     * stream is cancelled, or on `close()`.
     */
    connect(actor: A, options: { key?: string; signal?: AbortSignal } = {}): ReadableStream<Uint8Array> {
        if (this.closed) throw new Error('SseHub is closed');
        let client!: Client<A>;
        const stream = new ReadableStream<Uint8Array>(
            {
                start: (controller) => {
                    client = { actor, key: options.key ?? '', controller, closed: false };
                    this.clients.add(client);
                    // A first byte right away: some proxies hold the headers until one.
                    const retry = this.retryMs !== undefined ? `retry: ${Math.floor(this.retryMs)}\n` : '';
                    controller.enqueue(encoder.encode(`${retry}: connected\n\n`));
                    this.heartbeat ??= setInterval(() => this.beat(), this.heartbeatMs);
                },
                cancel: () => this.forget(client),
            },
            new ByteLengthQueuingStrategy({ highWaterMark: this.maxQueuedBytes }),
        );
        const { signal } = options;
        if (signal?.aborted) this.end(client);
        else signal?.addEventListener('abort', () => this.end(client), { once: true });
        return stream;
    }

    /** Ends every connection (what was queued is still sent) and refuses new ones. */
    close(): void {
        this.closed = true;
        for (const client of [...this.clients]) this.end(client);
    }

    private beat(): void {
        for (const client of [...this.clients]) this.write(client, HEARTBEAT);
    }

    /** Queues `chunk` for `client`; drops a client that is too far behind. */
    private write(client: Client<A>, chunk: Uint8Array): boolean {
        if (client.closed) return false;
        try {
            client.controller.enqueue(chunk);
        } catch {
            this.forget(client);
            return false;
        }
        if ((client.controller.desiredSize ?? 0) < 0) {
            this.logger.warn(`SSE client fell more than ${this.maxQueuedBytes} bytes behind; disconnecting it`);
            this.forget(client);
            // Discards its queue, unlike close().
            client.controller.error(new Error('SSE client too slow'));
            return false;
        }
        return true;
    }

    private end(client: Client<A>): void {
        if (client.closed) return;
        this.forget(client);
        try {
            client.controller.close();
        } catch {
            // Already errored or cancelled.
        }
    }

    private forget(client: Client<A>): void {
        client.closed = true;
        this.clients.delete(client);
        if (this.clients.size === 0 && this.heartbeat) {
            clearInterval(this.heartbeat);
            this.heartbeat = undefined;
        }
    }
}

export interface SseConfig<A = unknown> {
    hub: SseHub<A, unknown>;
    /** Where clients connect. Default `/api/events`. */
    path?: string;
    /** The feature's name (default `'sse'`), to register more than one. */
    name?: string;
    /**
     * Who is connecting; `null`/`undefined` answers 401. Default: the user
     * AuthFeature signed in (`c.get('authUser')`).
     */
    actor?: (c: Context) => A | null | undefined | Promise<A | null | undefined>;
    /** What identifies an actor for `maxClientsPerActor`. Default: its `id`. */
    actorKey?: (actor: A) => string;
    /** Connections this process keeps open; past it, 503. Default 10 000. */
    maxClients?: number;
    /** Connections one actor keeps open (tabs, devices); past it, 429. Default 10. */
    maxClientsPerActor?: number;
}

/** Bun.serve closes a connection idle this long, in seconds, unless told otherwise. */
const BUN_DEFAULT_IDLE_TIMEOUT_S = 10;
/** The largest per-request timeout Bun takes, in seconds. */
const BUN_MAX_TIMEOUT_S = 255;

function defaultActorKey(actor: unknown): string {
    const id = (actor as { id?: unknown } | null)?.id;
    return id === undefined || id === null ? String(actor) : String(id);
}

/**
 * Server-sent events: an authenticated GET endpoint whose clients join
 * `hub`. Each connection gets `text/event-stream` with `Cache-Control:
 * no-cache` and `X-Accel-Buffering: no` (so nginx does not buffer it), the
 * hub's heartbeat, and leaves the hub when the client goes away. On
 * shutdown every connection is ended before the server waits for open
 * requests. With HealthCheckFeature, /health gets an `sse` check with the
 * number of clients.
 *
 * Bun closes a connection that sends nothing for `idleTimeout` seconds (10
 * by default), less than the default heartbeat: each SSE request gets twice
 * the heartbeat instead (`server.timeout()`), and a warning is logged when
 * that is not possible and `idleTimeout` is shorter than the heartbeat.
 */
export class SseFeature<A = unknown> implements Feature {
    readonly name: string;
    optionalDependencies = ['auth', 'health'];
    private log: KernelLogger = consoleLogger;
    private readonly hub: SseHub<A, unknown>;
    private readonly path: string;
    private readonly actor?: SseConfig<A>['actor'];
    private readonly actorKey: (actor: A) => string;
    private readonly maxClients: number;
    private readonly maxClientsPerActor: number;
    private idleTimeoutS = BUN_DEFAULT_IDLE_TIMEOUT_S;
    private warnedIdleTimeout = false;

    constructor(config: SseConfig<A>) {
        this.hub = config.hub;
        this.name = config.name ?? 'sse';
        this.path = config.path ?? '/api/events';
        this.actor = config.actor;
        this.actorKey = config.actorKey ?? defaultActorKey;
        this.maxClients = config.maxClients ?? 10_000;
        this.maxClientsPerActor = config.maxClientsPerActor ?? 10;
    }

    /** The hub this endpoint's clients join. */
    getHub(): SseHub<A, unknown> {
        return this.hub;
    }

    async initialize(kernel: Kernel): Promise<void> {
        this.log = kernel.getLogger();
        if (this.hub.logger === consoleLogger) this.hub.logger = this.log;
        if (!this.actor && !kernel.getFeature('auth')) {
            throw new Error(`SseFeature '${this.name}': register AuthFeature or pass actor(c) to identify clients`);
        }
        this.idleTimeoutS = kernel.getConfig().idleTimeout ?? BUN_DEFAULT_IDLE_TIMEOUT_S;
        kernel.getFeature('health')?.addCheck(this.name, async () => ({
            status: 'ok',
            details: { clients: this.hub.size },
        }));
    }

    routes(app: Hono): void {
        app.get(this.path, (c) => this.open(c));
    }

    beforeShutdown(): void {
        this.hub.close();
    }

    private async open(c: Context): Promise<Response> {
        if (this.hub.isClosed) throw new HttpError(503, 'Shutting down');
        const actor = this.actor ? await this.actor(c) : (c.get('authUser') as A | null | undefined);
        if (actor === null || actor === undefined) throw new AuthError();
        const key = this.actorKey(actor);
        if (this.hub.size >= this.maxClients) {
            throw new HttpError(503, 'Too many live connections', { headers: { 'Retry-After': '30' } });
        }
        if (this.hub.countOf(key) >= this.maxClientsPerActor) {
            throw new HttpError(429, 'Too many live connections for this user');
        }
        this.keepAlive(c);
        const stream = this.hub.connect(actor, { key, signal: c.req.raw.signal });
        return new Response(stream, {
            headers: {
                'Content-Type': 'text/event-stream; charset=utf-8',
                'Cache-Control': 'no-cache',
                'X-Accel-Buffering': 'no',
            },
        });
    }

    /** Gives this request twice the heartbeat before Bun closes it as idle. */
    private keepAlive(c: Context): void {
        const server = c.env as { timeout?: (request: Request, seconds: number) => void } | undefined;
        if (typeof server?.timeout === 'function') {
            const seconds = Math.ceil((2 * this.hub.heartbeatMs) / 1000);
            server.timeout(c.req.raw, seconds > BUN_MAX_TIMEOUT_S ? 0 : seconds);
            return;
        }
        if (this.warnedIdleTimeout || this.idleTimeoutS === 0) return;
        if (this.idleTimeoutS * 1000 <= this.hub.heartbeatMs) {
            this.warnedIdleTimeout = true;
            this.log.warn(
                `SSE '${this.name}': idleTimeout (${this.idleTimeoutS}s) is not longer than the heartbeat ` +
                    `(${this.hub.heartbeatMs}ms) and this server cannot lift it per request: quiet connections ` +
                    'will be cut. Raise KernelConfig.idleTimeout or lower heartbeatMs.',
            );
        }
    }
}
