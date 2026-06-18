import { describe, it, expect } from 'bun:test';
import { IskraError } from '@iskra-bun/core';
import { SocketRouter, SocketConnectionError, SocketMessageError } from '../src';
import type { SocketContext } from '../src';

// Unit tests for the pure routing surface of SocketRouter. The integration
// suite in socket.test.ts drives the driver over a real WebSocket; here we
// exercise route registration and dispatch lookup in isolation.

describe('SocketRouter', () => {
    it('returns undefined for an event with no registered handler', () => {
        const router = new SocketRouter();
        expect(router.getHandler('missing')).toBeUndefined();
    });

    it('registers a handler and retrieves it by event name', () => {
        const router = new SocketRouter();
        const handler = async (_ctx: SocketContext) => {};
        router.on('ping', handler);
        expect(router.getHandler('ping')).toBe(handler);
    });

    it('returns this from on() to allow chaining', () => {
        const router = new SocketRouter();
        const noop = async (_ctx: SocketContext) => {};
        const returned = router.on('a', noop);
        expect(returned).toBe(router);

        // Chained registrations are all individually resolvable.
        router.on('b', noop).on('c', noop);
        expect(router.getHandler('a')).toBe(noop);
        expect(router.getHandler('b')).toBe(noop);
        expect(router.getHandler('c')).toBe(noop);
    });

    it('overwrites a handler when the same event is registered twice', () => {
        const router = new SocketRouter();
        const first = async (_ctx: SocketContext) => {};
        const second = async (_ctx: SocketContext) => {};
        router.on('dup', first);
        router.on('dup', second);
        expect(router.getHandler('dup')).toBe(second);
    });

    it('keeps distinct handlers for distinct events', () => {
        const router = new SocketRouter();
        const h1 = async (_ctx: SocketContext) => {};
        const h2 = async (_ctx: SocketContext) => {};
        router.on('one', h1).on('two', h2);
        expect(router.getHandler('one')).toBe(h1);
        expect(router.getHandler('two')).toBe(h2);
        expect(router.getHandler('one')).not.toBe(router.getHandler('two'));
    });

    it('treats event names as case-sensitive exact matches', () => {
        const router = new SocketRouter();
        const handler = async (_ctx: SocketContext) => {};
        router.on('Echo', handler);
        expect(router.getHandler('Echo')).toBe(handler);
        expect(router.getHandler('echo')).toBeUndefined();
    });

    it('supports an empty-string event key', () => {
        const router = new SocketRouter();
        const handler = async (_ctx: SocketContext) => {};
        router.on('', handler);
        expect(router.getHandler('')).toBe(handler);
    });

    it('invokes the stored handler when dispatched manually', async () => {
        const router = new SocketRouter();
        let seen: unknown;
        router.on('capture', async (ctx) => {
            seen = ctx.payload;
        });

        const handler = router.getHandler('capture');
        expect(handler).toBeDefined();

        // Build a minimal context — the router itself never touches the socket.
        await handler!({ payload: { hello: 'world' } } as unknown as SocketContext);
        expect(seen).toEqual({ hello: 'world' });
    });
});

// Error-type coverage lives here as well so the unit suite is self-contained.
describe('socket-kit errors (unit)', () => {
    it('SocketConnectionError defaults context to an empty object', () => {
        const err = new SocketConnectionError('boom');
        expect(err).toBeInstanceOf(IskraError);
        expect(err.code).toBe('SOCKET_CONNECTION_ERROR');
        expect(err.context).toEqual({});
        expect(err.cause).toBeUndefined();
    });

    it('SocketMessageError preserves cause and context', () => {
        const cause = new Error('parse fail');
        const err = new SocketMessageError('bad frame', { cause, context: { frame: 1 } });
        expect(err).toBeInstanceOf(IskraError);
        expect(err.code).toBe('SOCKET_MESSAGE_ERROR');
        expect(err.cause).toBe(cause);
        expect(err.context).toEqual({ frame: 1 });
    });
});
