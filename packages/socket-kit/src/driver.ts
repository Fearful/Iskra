import type { App, Driver } from '@iskra-bun/core';
import { SocketRouter } from './router';
import type { SocketData } from './router';
import type { Server, ServerWebSocket } from 'bun';
import { SocketMessageError } from './errors';

export class SocketDriver implements Driver {
    name = 'SocketDriver';
    private app: App | null = null;
    private router: SocketRouter;
    private port: number;
    private runningServer: Server<SocketData> | null = null;

    constructor(options: { port?: number; router?: SocketRouter } = {}) {
        this.port = options.port || 3001;
        this.router = options.router || new SocketRouter();
    }

    init(app: App) {
        this.app = app;
    }

    start() {
        this.app?.logger.info(`Starting SocketDriver on port ${this.port}...`);

        this.runningServer = Bun.serve<SocketData>({
            port: this.port,
            fetch(req, server) {
                // Assign a unique id per connection at upgrade time.
                const connectionId = crypto.randomUUID();
                if (server.upgrade(req, { data: { connectionId } })) {
                    return; // Bun handles the rest
                }
                return new Response("Upgrade failed", { status: 500 });
            },
            websocket: {
                open: (ws) => {
                    this.app?.logger.debug('Socket connected');
                    ws.subscribe('global');
                    this.app?.emit('socket:connected', {
                        id: ws.remoteAddress,
                        connectionId: ws.data.connectionId,
                    });
                },
                message: async (ws, message) => {
                    await this.handleMessage(ws, message);
                },
                close: (ws) => {
                    ws.unsubscribe('global');
                    this.app?.logger.debug('Socket disconnected');
                    this.app?.emit('socket:disconnected', {
                        id: ws.remoteAddress,
                        connectionId: ws.data.connectionId,
                    });
                }
            }
        });
    }

    /** Publish to all sockets subscribed to the global topic. */
    public broadcast(event: string, payload: unknown) {
        this.runningServer?.publish('global', JSON.stringify({ event, payload }));
    }

    /** Publish to all sockets subscribed to a specific room. */
    public broadcastTo(room: string, event: string, payload: unknown) {
        this.runningServer?.publish(room, JSON.stringify({ event, payload }));
    }

    stop() {
        this.runningServer?.stop();
        this.app?.logger.info('SocketDriver stopped');
    }

    private async handleMessage(ws: ServerWebSocket<SocketData>, message: string | Buffer) {
        try {
            const text = typeof message === 'string' ? message : new TextDecoder().decode(message);
            const eventData = JSON.parse(text);
            const { event, payload } = eventData;

            if (!event) return;

            // 1. Try Router
            const handler = this.router.getHandler(event);
            if (handler && this.app) {
                await handler({
                    app: this.app,
                    logger: this.app.logger.child({ source: 'socket', event }),
                    payload: payload || {},
                    socket: ws,
                    reply: (data) => ws.send(JSON.stringify({ event: `${event}:reply`, payload: data })),
                    broadcast: (evt, data) => this.runningServer?.publish(evt, JSON.stringify(data)),
                    join: (room) => ws.subscribe(room),
                    leave: (room) => ws.unsubscribe(room),
                });
            } else {
                // 2. Fallback to Global App Event
                this.app?.emit(`socket:${event}`, { socket: ws, payload });
            }

        } catch (err) {
            const socketErr = new SocketMessageError('Failed to handle socket message', {
                cause: err instanceof Error ? err : new Error(String(err)),
            });
            this.app?.logger.error({ err: socketErr }, socketErr.message);
        }
    }
}
