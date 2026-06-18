import type { App, Context } from '@iskra-bun/core';
import type { ServerWebSocket } from 'bun';

export interface SocketContext<T = any> extends Context<T> {
    socket: ServerWebSocket<any>;
    broadcast(event: string, payload: any): void;
}

export type SocketHandler = (ctx: SocketContext) => Promise<void> | void;

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
