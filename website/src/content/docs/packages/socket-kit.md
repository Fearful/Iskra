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

`port` defaults to `3001`; `port: 0` picks a free port, which `driver.port` returns once the app has started (useful in tests).

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
    // ctx.broadcast() — publish to all sockets on a topic (subject to canPublish)
    // ctx.join(room)  — subscribe this socket to a room (subject to canJoin)
    // ctx.leave(room) — unsubscribe this socket from a room
});
```

### Typed Handlers

`on<TPayload>()` is generic, so `ctx.payload` is typed without any cast at the registration site. `SocketContext` and `SocketHandler` accept two generics — the payload type and the per-connection data type:

```typescript
import type { SocketContext, SocketHandler, SocketData } from '@iskra-bun/socket-kit';

interface ChatPayload { text: string; user: string }

// Extend SocketData to add per-connection fields
interface MyData extends SocketData {
    userId: string;
}

// ctx.payload is ChatPayload here — no `as SocketHandler` cast needed.
router.on<ChatPayload>('chat:message', async (ctx) => {
    ctx.logger.info({ user: ctx.payload.user }, ctx.payload.text);
});

// Both generics: typed payload and typed ws.data.
const handler: SocketHandler<ChatPayload, MyData> = async (ctx) => {
    ctx.logger.info({ id: ctx.socket.data.userId }, ctx.payload.text);
};

router.on<ChatPayload, MyData>('chat:typed', handler);
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

### Wire frame clients receive

Every server-to-client frame — `ctx.reply`, `ctx.broadcast`, `driver.broadcast`, and `driver.broadcastTo` — uses the same envelope:

```json
{ "event": "<topic-or-event>", "payload": <data> }
```

For `ctx.broadcast(topic, data)` and `driver.broadcastTo(room, event, payload)`, the `event` field carries the topic/event name and `payload` carries your data. Clients should always read `data.event` and `data.payload` rather than assuming raw data.

## Broadcast

### Global broadcast

Send a message to every connected socket (all sockets are auto-subscribed to the `global` topic on connect):

```typescript
// From a handler — wrapped as { event: 'notifications', payload: {...} }
ctx.broadcast('notifications', { message: 'New user connected' });

// From the driver directly
socketDriver.broadcast('system:alert', { level: 'warning', msg: 'Maintenance' });
```

### Rooms

Subscribe a socket to a named room, then broadcast only to that room. Rooms are native Bun pub/sub topics.

```typescript
// In a handler — join or leave a room
router.on('room:join', async (ctx) => {
    ctx.join(ctx.payload.room);          // subscribe this socket (subject to canJoin)
    ctx.reply({ status: 'joined' });
});

router.on('room:leave', async (ctx) => {
    ctx.leave(ctx.payload.room);         // unsubscribe this socket
    ctx.reply({ status: 'left' });
});

// Broadcast to a specific room from the driver
socketDriver.broadcastTo('lobby', 'chat:message', { text: 'Hello lobby!' });
```

`broadcastTo(room, event, payload)` is available on the `SocketDriver` instance.

#### Per-connection (user) rooms

There is no special "user room" type — a per-connection room is just a room named after the socket's `connectionId`. Because `connectionId` is unique per connection, subscribing a socket to a room of its own id namespaces messages to that one connection:

```typescript
router.on('subscribe:me', async (ctx) => {
    ctx.join(ctx.socket.data.connectionId); // private room for this connection
    ctx.reply({ status: 'ok' });
});

// Later, target just that connection from the driver:
socketDriver.broadcastTo(connectionId, 'inbox:new', { unread: 3 });
```

## Defaults

Out of the box the driver is open: it is meant to be locked down with these options before it faces users.

| What | Default | Option to restrict it |
| --- | --- | --- |
| Who can connect | any origin, no authentication (a warning is logged at start) | `allowedOrigins`, `authenticate` |
| Which rooms a client can join | any | `canJoin` |
| Which topics a client can publish to | any, `global` (every socket) included | `canPublish` |
| Which unhandled events reach the app bus | all, as `socket:<event>` | `allowedEvents` |

Frame size (`maxPayloadLength`) and message rate (`rateLimit`) are bounded by default; see [DoS Protection](#dos-protection).

## Handshake: origin and authentication

Without configuration the driver accepts connections from any origin without authentication (and logs a warning at start). A browser sends the user's cookies with the WebSocket handshake, so any site could open a connection on their behalf (cross-site WebSocket hijacking).

```typescript
const driver = new SocketDriver({
    port: 3001,
    router,
    // Handshakes with any other Origin header get 403; no Origin (non-browser clients) is accepted.
    allowedOrigins: ['https://app.example.com'],
    // The return value becomes ctx.socket.data.auth; null/undefined/false (or a throw) => 401.
    authenticate: (req) => redeemTicket(new URL(req.url).searchParams.get('ticket')),
});
```

### Passing the credential

A browser cannot set headers on a WebSocket, so the credential travels in the URL, in a subprotocol or in a cookie. The URL of the handshake ends up in the access logs of every proxy and load balancer on the way, and in the browser's history: do not put a long-lived token there (a session token, a JWT, an API key). In order of preference:

- **A short-lived, single-use ticket.** An authenticated HTTP route issues a random ticket valid for a few seconds, the client connects with it, and `authenticate` redeems it once, so a URL that was logged is worthless:

```typescript
// One instance; with several, keep tickets in a shared store with an expiry
// and read-and-delete them atomically (Redis SET … EX and GETDEL).
const tickets = new Map<string, { userId: string; expires: number }>();

// HTTP side, behind your auth: a ticket valid for 30 s.
app.post('/api/ws-ticket', requireAuth(kernel), (c) => {
    const ticket = crypto.randomUUID();
    tickets.set(ticket, { userId: c.get('user').id, expires: Date.now() + 30_000 });
    return c.json({ ticket });
});

// Socket side: each ticket works once.
function redeemTicket(ticket: string | null) {
    const entry = ticket ? tickets.get(ticket) : undefined;
    if (ticket) tickets.delete(ticket);
    return entry && entry.expires > Date.now() ? { userId: entry.userId } : null;
}

// Browser
const { ticket } = await (await fetch('/api/ws-ticket', { method: 'POST' })).json();
const ws = new WebSocket(`wss://app.example.com/ws?ticket=${ticket}`);
```

- **The `Sec-WebSocket-Protocol` header**, which the browser lets you set: `new WebSocket(url, ['bearer', token])`. Bun answers with the first protocol (`bearer`), and `authenticate` reads the token from `req.headers.get('sec-websocket-protocol')` (a subprotocol cannot contain `/`, `=`, `,` or spaces: use a base64url or hex token). Proxies seldom log this header, but the token is still long-lived: a ticket is better.
- **The session cookie**, which the browser sends by itself: then set `allowedOrigins`, since that cookie is exactly what lets another site connect as the user.

An app that authenticates in the first message instead (an `auth` event carrying a token) must close the connections that don't: one that never sends anything stays open as long as its client answers pings. Give each connection a deadline with `driver.close(connectionId, code?, reason?)`, which returns `false` when the connection is already gone:

```typescript
app.on('socket:connected', ({ payload: { connectionId } }) => {
    setTimeout(() => {
        if (!sessions.has(connectionId)) driver.close(connectionId, 1008, 'Authentication timeout');
    }, 10_000);
});
```

The [`chat-app`](https://github.com/fearful/iskra/tree/main/templates/chat-app) template does this (`handleConnect`).

## Authorization

The driver accepts optional `canJoin` and `canPublish` hooks that gate room joins and publishes per connection. Both default to allow-all when omitted: any client can join any room (another user's per-connection room included) and publish to any topic, `global` included, until you set them.

```typescript
import { SocketDriver } from '@iskra-bun/socket-kit';
import type { CanJoin, CanPublish } from '@iskra-bun/socket-kit';

// (connection, room) => boolean — return false to deny the join
const canJoin: CanJoin = (connection, room) => {
    // e.g. only allow joining your own per-connection room or public rooms
    return room === 'public' || room === connection.data.connectionId;
};

// (connection, topic) => boolean — return false to deny the publish
const canPublish: CanPublish = (connection, topic) => topic !== 'global';

const driver = new SocketDriver({ port: 3001, router, canJoin, canPublish });
```

- `canJoin` gates `ctx.join(room)`. When it returns `false`, the socket is **not** subscribed and a warning is logged.
- `canPublish` gates `ctx.broadcast(topic, data)`. When it returns `false`, the frame is **not** published.
- Both hooks receive the connection's `ServerWebSocket<SocketData>`, so you can read `connection.data.connectionId` (and any custom `SocketData` fields, such as an authenticated `userId`) to make the decision.
- `driver.broadcast` and `driver.broadcastTo` are server-side calls and are **not** subject to these hooks — only the client-driven `ctx.join` / `ctx.broadcast` paths are gated.

## DoS Protection

The driver bounds inbound work two ways, both configurable on `SocketDriverOptions`:

| Option | Default | Effect |
| --- | --- | --- |
| `maxPayloadLength` | `16 * 1024` (16 KiB) | Max inbound frame size in bytes, wired into Bun's `websocket.maxPayloadLength`. A larger frame makes Bun close the connection, bounding `JSON.parse` cost. |
| `rateLimit` | `100` | Max inbound messages accepted per connection per window. Frames over budget are dropped (handler not invoked) and a warning is logged. |
| `rateWindowMs` | `1000` | Length of the rate-limit window in milliseconds. The budget resets when the window elapses. |

```typescript
const driver = new SocketDriver({
    port: 3001,
    router,
    maxPayloadLength: 32 * 1024, // 32 KiB frames
    rateLimit: 50,               // 50 messages...
    rateWindowMs: 1000,          // ...per second, per connection
});
```

The resolved frame limit is readable as `driver.maxPayloadLength`. Rate-limit bookkeeping is per `connectionId` and is cleared when the connection closes.

### Fallback event allow-list

Messages with no matching router handler fall back to the app event bus as `socket:${event}`. Set `allowedEvents` to restrict which unmatched event names may re-emit; names outside the set are dropped (and logged). When `allowedEvents` is omitted, all fallback events are re-emitted.

```typescript
const driver = new SocketDriver({
    port: 3001,
    router,
    allowedEvents: ['presence:ping', 'cursor:move'],
});
```

## Connection IDs

A request that is not a WebSocket handshake (a plain `GET` from a browser or a health check) gets `426 Upgrade Required`.

Every connection is assigned a unique `connectionId` (UUID) at upgrade time, stored on the typed socket data (`ws.data.connectionId`). This is a reliable per-client identifier — unlike `remoteAddress`, it is guaranteed to be unique across reconnects.

The `connectionId` is the payload of the lifecycle events:

```typescript
app.on('socket:connected', (ctx) => {
    console.log(ctx.payload.connectionId); // e.g. "a3f1c2d0-..."
});
```

## Lifecycle Events

The driver emits events automatically:

- `socket:connected` — when a client connects (payload: `{ connectionId }`)
- `socket:disconnected` — when a client disconnects (payload: `{ connectionId }`)
- `socket:${event}` — fallback when there is no router handler (subject to `allowedEvents`); the reserved names `connected` and `disconnected` are never re-emitted from a client

```typescript
app.on('socket:connected', (ctx) => {
    console.log(`Client ${ctx.payload.connectionId} connected`);
});

app.on('socket:disconnected', (ctx) => {
    console.log(`Client ${ctx.payload.connectionId} disconnected`);
});
```

## Errors

```typescript
import { SocketConnectionError, SocketMessageError } from '@iskra-bun/socket-kit';
// Handled internally and logged.
```
