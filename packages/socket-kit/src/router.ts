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
    /**
     * Publish to all sockets subscribed to topic (e.g. 'global'). The frame is
     * wrapped in the driver envelope: {event: topic, payload: data}. Subject to
     * the driver's canPublish authorization hook.
     */
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

    /**
     * Register a handler for an event. The generic lets callers pass a handler
     * with a narrower payload type without an `as SocketHandler` cast; the
     * handler is stored widened internally.
     */
    on<TPayload = unknown, TData extends SocketData = SocketData>(
        event: string,
        handler: SocketHandler<TPayload, TData>
    ) {
        this.handlers.set(event, handler as SocketHandler);
        return this;
    }

    getHandler(event: string): SocketHandler | undefined {
        return this.handlers.get(event);
    }
}
