import type { App, Driver } from '@iskra-bun/core';
import { SocketRouter } from './router';
import type { SocketData } from './router';
import type { Server, ServerWebSocket } from 'bun';
import { SocketMessageError } from './errors';

/** Default cap on a single inbound frame (16 KiB) to bound JSON.parse cost. */
const DEFAULT_MAX_PAYLOAD_LENGTH = 16 * 1024;
/** Default per-connection inbound message budget per rate window. */
const DEFAULT_RATE_LIMIT = 100;
/** Default rate-limit window in milliseconds. */
const DEFAULT_RATE_WINDOW_MS = 1000;

/** Authorization hook gating which rooms a connection may join. */
export type CanJoin = (connection: ServerWebSocket<SocketData>, room: string) => boolean;
/** Authorization hook gating which topics a connection may publish to. */
export type CanPublish = (connection: ServerWebSocket<SocketData>, topic: string) => boolean;
/**
 * Authenticates an upgrade request. The returned value is stored as
 * `socket.data.auth`; return `null`, `undefined` or `false` (or throw) to
 * refuse the connection with 401.
 */
export type Authenticate = (req: Request) => unknown | Promise<unknown>;

/**
 * Event names the driver itself emits on the app bus (`socket:<name>`).
 * Clients may not trigger them through the fallback path.
 */
const RESERVED_EVENTS: ReadonlySet<string> = new Set(['connected', 'disconnected']);

export interface SocketDriverOptions {
    /** Port to listen on. Defaults to 3001; 0 picks a free port (read it from `driver.port`). */
    port?: number;
    router?: SocketRouter;
    /** Max inbound frame size in bytes. Defaults to 16 KiB. */
    maxPayloadLength?: number;
    /** Gate ctx.join; deny by returning false. Defaults to allow-all. */
    canJoin?: CanJoin;
    /** Gate ctx.broadcast; deny by returning false. Defaults to allow-all. */
    canPublish?: CanPublish;
    /** Allowed fallback event names; when set, others are dropped. */
    allowedEvents?: readonly string[];
    /**
     * Browser origins allowed to connect (exact match, e.g.
     * "https://app.example.com"). A handshake with any other `Origin` is
     * refused with 403, which blocks cross-site WebSocket hijacking; requests
     * without an Origin (non-browser clients) are allowed. Default: any origin.
     */
    allowedOrigins?: readonly string[];
    /** Authenticate the upgrade request (see Authenticate). Default: none. */
    authenticate?: Authenticate;
    /** Max inbound messages per connection per window. Defaults to 100. */
    rateLimit?: number;
    /** Rate-limit window in ms. Defaults to 1000. */
    rateWindowMs?: number;
}

/** A room or topic name as the authz hooks expect it: a non-empty string. */
function isTopicName(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

/** Per-connection rate-limit bookkeeping, replaced immutably on each update. */
interface RateState {
    count: number;
    windowStart: number;
}

export class SocketDriver implements Driver {
    name = 'SocketDriver';
    private app: App | null = null;
    private router: SocketRouter;
    private configuredPort: number;
    private runningServer: Server<SocketData> | null = null;

    public readonly maxPayloadLength: number;
    private readonly canJoin: CanJoin;
    private readonly canPublish: CanPublish;
    private readonly allowedEvents: ReadonlySet<string> | null;
    private readonly allowedOrigins: ReadonlySet<string> | null;
    private readonly authenticate?: Authenticate;
    private readonly rateLimit: number;
    private readonly rateWindowMs: number;
    private rateStates: Map<string, RateState> = new Map();
    /** Open connections, by connectionId. */
    private sockets: Map<string, ServerWebSocket<SocketData>> = new Map();

    constructor(options: SocketDriverOptions = {}) {
        this.configuredPort = options.port ?? 3001;
        this.router = options.router || new SocketRouter();
        this.maxPayloadLength = options.maxPayloadLength ?? DEFAULT_MAX_PAYLOAD_LENGTH;
        this.canJoin = options.canJoin ?? (() => true);
        this.canPublish = options.canPublish ?? (() => true);
        this.allowedEvents = options.allowedEvents ? new Set(options.allowedEvents) : null;
        this.allowedOrigins = options.allowedOrigins ? new Set(options.allowedOrigins) : null;
        this.authenticate = options.authenticate;
        this.rateLimit = options.rateLimit ?? DEFAULT_RATE_LIMIT;
        this.rateWindowMs = options.rateWindowMs ?? DEFAULT_RATE_WINDOW_MS;
    }

    /**
     * The port the server listens on once started (the one the OS picked for
     * `port: 0`); before start, the configured port.
     */
    get port(): number {
        return this.runningServer?.port ?? this.configuredPort;
    }

    init(app: App) {
        this.app = app;
    }

    start() {
        this.app?.logger.info(`Starting SocketDriver on port ${this.configuredPort}...`);
        if (!this.allowedOrigins && !this.authenticate) {
            this.app?.logger.warn(
                'SocketDriver accepts connections from any origin without authentication; ' +
                    'set allowedOrigins and/or authenticate to prevent cross-site WebSocket hijacking',
            );
        }

        this.runningServer = Bun.serve<SocketData>({
            port: this.configuredPort,
            fetch: async (req, server) => {
                const origin = req.headers.get('origin');
                if (this.allowedOrigins && origin && !this.allowedOrigins.has(origin)) {
                    return new Response('Forbidden origin', { status: 403 });
                }

                let auth: unknown;
                if (this.authenticate) {
                    try {
                        auth = await this.authenticate(req);
                    } catch (err) {
                        this.app?.logger.warn({ err }, 'Socket authenticate() threw; refusing connection');
                        auth = null;
                    }
                    if (auth === null || auth === undefined || auth === false) {
                        return new Response('Unauthorized', { status: 401 });
                    }
                }

                // Assign a unique id per connection at upgrade time.
                const connectionId = crypto.randomUUID();
                if (server.upgrade(req, { data: { connectionId, auth } })) {
                    return; // Bun handles the rest
                }
                // Not a (valid) WebSocket handshake, e.g. a plain GET from a
                // browser or a load balancer's health check: the client's
                // mistake, not a server error (a 500 marked the service down).
                return new Response('Expected a WebSocket upgrade', {
                    status: 426,
                    headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
                });
            },
            websocket: {
                maxPayloadLength: this.maxPayloadLength,
                open: (ws) => {
                    this.sockets.set(ws.data.connectionId, ws);
                    this.app?.logger.debug('Socket connected');
                    ws.subscribe('global');
                    this.app?.emit('socket:connected', {
                        connectionId: ws.data.connectionId,
                    });
                },
                message: async (ws, message) => {
                    await this.handleMessage(ws, message);
                },
                close: (ws) => {
                    this.sockets.delete(ws.data.connectionId);
                    ws.unsubscribe('global');
                    this.rateStates.delete(ws.data.connectionId);
                    this.app?.logger.debug('Socket disconnected');
                    this.app?.emit('socket:disconnected', {
                        connectionId: ws.data.connectionId,
                    });
                },
            },
        });
    }

    /**
     * Closes the connection `connectionId` (as in `socket:connected` and a
     * handler's `ctx.socket.data`); false when it is not open. For an app that
     * authenticates in a message rather than at the handshake: a connection
     * that never does stays open as long as its client answers pings, so
     * close the ones that have not authenticated in time.
     */
    public close(connectionId: string, code = 1000, reason = ''): boolean {
        const ws = this.sockets.get(connectionId);
        if (!ws) return false;
        ws.close(code, reason);
        return true;
    }

    /** Publish to all sockets subscribed to the global topic. */
    public broadcast(event: string, payload: unknown) {
        this.runningServer?.publish('global', JSON.stringify({ event, payload }));
    }

    /** Publish to all sockets subscribed to a specific room. */
    public broadcastTo(room: string, event: string, payload: unknown) {
        this.runningServer?.publish(room, JSON.stringify({ event, payload }));
    }

    /**
     * Closes every open connection (1001 "going away", so clients see a clean
     * close and can reconnect elsewhere) and the listener. A plain
     * `server.stop()` only stopped accepting: connected clients kept being
     * served after app.stop(), by handlers whose DB and other drivers were
     * already stopped.
     */
    async stop() {
        const server = this.runningServer;
        this.runningServer = null;
        for (const ws of this.sockets.values()) ws.close(1001, 'Server shutting down');
        this.sockets.clear();
        if (server) {
            // stop(true) closes the listener at once, but with WebSocket
            // connections its promise may never settle (Bun 1.3): don't let
            // app.stop() hang on it.
            let timer: ReturnType<typeof setTimeout> | undefined;
            await Promise.race([
                Promise.resolve(server.stop(true)).catch(() => {}),
                new Promise<void>((resolve) => {
                    timer = setTimeout(resolve, 1000);
                }),
            ]);
            clearTimeout(timer);
        }
        this.app?.logger.info('SocketDriver stopped');
    }

    /**
     * Returns true if the connection is within its rate budget, recording the
     * message. Bookkeeping is immutable: a fresh RateState replaces the old one.
     */
    private allowMessage(ws: ServerWebSocket<SocketData>): boolean {
        const now = Date.now();
        const key = ws.data.connectionId;
        const prev = this.rateStates.get(key);
        const next: RateState =
            !prev || now - prev.windowStart >= this.rateWindowMs
                ? { count: 1, windowStart: now }
                : { count: prev.count + 1, windowStart: prev.windowStart };
        this.rateStates.set(key, next);
        if (next.count === this.rateLimit + 1) {
            // Once per window: a warning per dropped frame let a flooding
            // client write ~23 bytes of log for each byte it sent.
            this.app?.logger.warn(
                { connectionId: key },
                'Socket message rate limit exceeded; dropping frames until the window ends',
            );
        }
        return next.count <= this.rateLimit;
    }

    private async handleMessage(ws: ServerWebSocket<SocketData>, message: string | Buffer) {
        try {
            if (!this.allowMessage(ws)) return;

            const text = typeof message === 'string' ? message : new TextDecoder().decode(message);
            let eventData: { event?: unknown; payload?: unknown } | null;
            try {
                eventData = JSON.parse(text);
            } catch {
                // The client's mistake: an error with a stack for each such
                // frame was another way to flood the logs.
                this.app?.logger.debug(
                    { connectionId: ws.data.connectionId },
                    'Dropping a socket frame that is not JSON',
                );
                return;
            }
            if (!eventData || typeof eventData !== 'object') return;
            const { event } = eventData;
            // Only string names: `["disconnected"]` passed the reserved-name
            // check and then stringified to "socket:disconnected".
            if (typeof event !== 'string' || !event) return;
            // Missing payload defaults to {}; falsy values (0, false, "") are kept.
            const payload = eventData.payload ?? {};

            const handler = this.router.getHandler(event);
            if (handler && this.app) {
                await handler({
                    app: this.app,
                    logger: this.app.logger.child({ source: 'socket', event }),
                    payload,
                    socket: ws,
                    reply: (data) => ws.send(JSON.stringify({ event: `${event}:reply`, payload: data })),
                    broadcast: (topic, data) => this.publishAuthorized(ws, topic, data),
                    join: (room) => this.joinAuthorized(ws, room),
                    leave: (room) => ws.unsubscribe(room),
                });
            } else {
                // Fallback to the global app event bus, but only for events that
                // pass the allow-list (when configured). Unknown names are dropped,
                // and clients can never fire the driver's own lifecycle events.
                if (RESERVED_EVENTS.has(event)) {
                    this.app?.logger.warn({ event }, 'Dropping client socket event with a reserved name');
                    return;
                }
                if (this.allowedEvents && !this.allowedEvents.has(event)) {
                    this.app?.logger.warn({ event }, 'Dropping fallback socket event not in the allowed set');
                    return;
                }
                this.app?.emit(`socket:${event}`, { socket: ws, payload });
            }
        } catch (err) {
            const socketErr = new SocketMessageError('Failed to handle socket message', {
                cause: err instanceof Error ? err : new Error(String(err)),
            });
            this.app?.logger.error({ err: socketErr }, socketErr.message);
        }
    }

    /** Subscribe to a room only when the authz hook permits it. */
    private joinAuthorized(ws: ServerWebSocket<SocketData>, room: string) {
        if (!isTopicName(room)) {
            this.app?.logger.warn(
                { connectionId: ws.data.connectionId },
                'Denied socket join: the room is not a string',
            );
            return;
        }
        if (!this.canJoin(ws, room)) {
            this.app?.logger.warn(
                { connectionId: ws.data.connectionId, room },
                'Denied socket join to unauthorized room',
            );
            return;
        }
        ws.subscribe(room);
    }

    /** Publish to a topic only when the authz hook permits it, using the envelope. */
    private publishAuthorized(ws: ServerWebSocket<SocketData>, topic: string, data: unknown) {
        // Checked before the hook: a handler passing the client's payload on
        // could hand it `["global"]`, which passes `topic !== 'global'` and
        // which Bun's publish() turns into "global".
        if (!isTopicName(topic)) {
            this.app?.logger.warn(
                { connectionId: ws.data.connectionId },
                'Denied socket broadcast: the topic is not a string',
            );
            return;
        }
        if (!this.canPublish(ws, topic)) {
            this.app?.logger.warn(
                { connectionId: ws.data.connectionId, topic },
                'Denied socket broadcast to unauthorized topic',
            );
            return;
        }
        this.runningServer?.publish(topic, JSON.stringify({ event: topic, payload: data }));
    }
}

// Lifecycle events a SocketDriver emits on the app. Unrouted messages are
// emitted as `socket:<event>` with `{ socket, payload }` (not typed here).
declare module '@iskra-bun/core' {
    interface AppEvents {
        'socket:connected': { connectionId: string };
        'socket:disconnected': { connectionId: string };
    }
}
