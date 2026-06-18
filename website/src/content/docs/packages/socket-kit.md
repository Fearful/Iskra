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

router.on('evento', async (ctx: SocketContext) => {
    // ctx.app      — referencia a la App
    // ctx.logger   — logger con contexto del evento
    // ctx.payload  — datos del mensaje
    // ctx.socket   — ServerWebSocket de Bun
    // ctx.reply()  — responder al cliente
    // ctx.broadcast() — broadcast a todos los conectados
});
```

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

```typescript
// Desde un handler
ctx.broadcast('notifications', { message: 'Nuevo usuario conectado' });

// Desde el driver directamente
socketDriver.broadcast('system:alert', { level: 'warning', msg: 'Mantenimiento' });
```

## Lifecycle Events

The driver emits events automatically:

- `socket:connected` — when a client connects
- `socket:${event}` — fallback when there is no handler in the router

## Errors

```typescript
import { SocketConnectionError, SocketMessageError } from '@iskra-bun/socket-kit';
// Se manejan internamente y se loguean
```
