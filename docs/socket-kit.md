# @iskra-bun/socket-kit

WebSocket nativo de Bun para comunicacion en tiempo real.

## Inicio Rapido

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

El router mapea eventos a handlers:

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

## Protocolo de Mensajes

Los mensajes se envian como JSON:

```json
{ "event": "chat:message", "payload": { "text": "Hola!", "user": "Juan" } }
```

Las respuestas se envian automaticamente con el sufijo `:reply`:

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

## Eventos del Ciclo de Vida

El driver emite eventos automaticamente:

- `socket:connected` — cuando se conecta un cliente
- `socket:${event}` — fallback cuando no hay handler en el router

## Errores

```typescript
import { SocketConnectionError, SocketMessageError } from '@iskra-bun/socket-kit';
// Se manejan internamente y se loguean
```
