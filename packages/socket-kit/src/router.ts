import type { App, Context } from '@iskra-bun/core';
import type { ServerWebSocket } from 'bun';

/**
 * Minimum data shape that every socket connection carries on ws.data.
 * Drivers may extend this with app-specific fields via the TData generic.
 */
export interface SocketData {
    connectionId: string;
}

export interface SocketContext<TPayload = unknown, TData extends SocketData = SocketData> extends Context<TPayload> {
    socket: ServerWebSocket<TData>;
    /** Send a message back to this socket only. */
    reply(data: unknown): void;
    /** Publish data to all sockets subscribed to topic (e.g. 'global'). data is sent as-is. */
    broadcast(topic: string, data: unknown): void;
    /** Subscribe this socket to a named room. */
    join(room: string): void;
    /** Unsubscribe this socket from a named room. */
    leave(room: string): void;
}

export type SocketHandler<TPayload = unknown, TData extends SocketData = SocketData> = (
    ctx: SocketContext<TPayload, TData>
) => Promise<void> | void;

export class SocketRouter {
    private handlers: Map<string, SocketHandler> = new Map();

    on(event: string, handler: SocketHandler) {
        this.handlers.set(event, handler);
        return this;
    }

    getHandler(event: string): SocketHandler | undefined {
        return this.handlers.get(event);
    }
}
