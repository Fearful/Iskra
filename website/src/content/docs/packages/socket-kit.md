---
title: Socket Kit
description: Bun-native WebSocket for real-time communication.
---

Bun-native WebSocket for real-time communication.

## Quick Start

```typescript
import { App } from '@iskra-bun/core';
import { SocketDriver, SocketRouter } from '@iskra-bun/socket-kit';

const router = new SocketRouter();

router.on('chat:message', async (ctx) => {
    ctx.logger.info({ msg: ctx.payload }, 'Mensaje recibido');
    ctx.broadcast('chat:message', ctx.payload);
});

router.on('user:typing', async (ctx) => {
    ctx.reply({ status: 'ok' });
});

const app = new App({ name: 'ChatApp' });
app.register(new SocketDriver({ port: 3001, router }));

await app.start();
```

## SocketRouter

The router maps events to handlers:

```typescript
const router = new SocketRouter();

router.on('event', async (ctx: SocketContext) => {
    // ctx.app         — App reference
    // ctx.logger      — context-aware logger
    // ctx.payload     — message data
    // ctx.socket      — Bun ServerWebSocket
    // ctx.reply()     — send a message back to this socket only
    // ctx.broadcast() — publish to all sockets (global topic)
    // ctx.join(room)  — subscribe this socket to a room
    // ctx.leave(room) — unsubscribe this socket from a room
});
```

### Typed Handlers

`SocketContext` and `SocketHandler` accept two generics for full type safety:

```typescript
import type { SocketContext, SocketHandler, SocketData } from '@iskra-bun/socket-kit';

interface ChatPayload { text: string; user: string }

// Extend SocketData to add per-connection fields
interface MyData extends SocketData {
    userId: string;
}

const handler: SocketHandler<ChatPayload, MyData> = async (ctx: SocketContext<ChatPayload, MyData>) => {
    ctx.logger.info({ user: ctx.payload.user }, ctx.payload.text);
};

router.on('chat:message', handler);
```

`SocketData` is the base interface every connection carries and includes `connectionId` (see [Connection IDs](#connection-ids)).

## Message Protocol

Messages are sent as JSON:

```json
{ "event": "chat:message", "payload": { "text": "Hola!", "user": "Juan" } }
```

Replies are sent automatically with the `:reply` suffix:

```json
{ "event": "chat:message:reply", "payload": { "status": "ok" } }
```

## Broadcast

### Global broadcast

Send a message to every connected socket:

```typescript
// From a handler
ctx.broadcast('notifications', { message: 'New user connected' });

// From the driver directly
socketDriver.broadcast('system:alert', { level: 'warning', msg: 'Maintenance' });
```

### Rooms

Subscribe a socket to a named room, then broadcast only to that room. Rooms are native Bun pub/sub topics.

```typescript
// In a handler — join or leave a room
router.on('room:join', async (ctx) => {
    ctx.join(ctx.payload.room);          // subscribe this socket
    ctx.reply({ status: 'joined' });
});

router.on('room:leave', async (ctx) => {
    ctx.leave(ctx.payload.room);         // unsubscribe this socket
    ctx.reply({ status: 'left' });
});

// Broadcast to a specific room from the driver
socketDriver.broadcastTo('lobby', 'chat:message', { text: 'Hello lobby!' });
```

`broadcastTo(room, event, payload)` is available on the `SocketDriver` instance. The global `broadcast()` continues to work as before.

## Connection IDs

Every connection is assigned a unique `connectionId` (UUID) at upgrade time, stored on the typed socket data (`ws.data.connectionId`). This is a reliable per-client identifier — unlike `remoteAddress`, it is guaranteed to be unique across reconnects.

The `connectionId` is included in lifecycle event payloads:

```typescript
app.on('socket:connected', (payload) => {
    console.log(payload.connectionId); // e.g. "a3f1c2d0-..."
    console.log(payload.id);           // remote address (informational)
});
```

## Lifecycle Events

The driver emits events automatically:

- `socket:connected` — when a client connects (payload: `{ id, connectionId }`)
- `socket:disconnected` — when a client disconnects (payload: `{ id, connectionId }`)
- `socket:${event}` — fallback when there is no handler in the router

```typescript
app.on('socket:connected', ({ connectionId }) => {
    console.log(`Client ${connectionId} connected`);
});

app.on('socket:disconnected', ({ connectionId }) => {
    console.log(`Client ${connectionId} disconnected`);
});
```

## Errors

```typescript
import { SocketConnectionError, SocketMessageError } from '@iskra-bun/socket-kit';
// Se manejan internamente y se loguean
```
