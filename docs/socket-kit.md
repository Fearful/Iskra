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
    // ctx.app         — referencia a la App
    // ctx.logger      — logger con contexto del evento
    // ctx.payload     — datos del mensaje
    // ctx.socket      — ServerWebSocket de Bun
    // ctx.reply()     — responder solo a este socket
    // ctx.broadcast() — publicar a todos los sockets (topico global)
    // ctx.join(room)  — suscribir este socket a una sala
    // ctx.leave(room) — desuscribir este socket de una sala
});
```

### Handlers tipados

`SocketContext` y `SocketHandler` aceptan dos genericos para tipado completo:

```typescript
import type { SocketContext, SocketHandler, SocketData } from '@iskra-bun/socket-kit';

interface ChatPayload { text: string; user: string }

// Extender SocketData para agregar campos por conexion
interface MyData extends SocketData {
    userId: string;
}

const handler: SocketHandler<ChatPayload, MyData> = async (ctx: SocketContext<ChatPayload, MyData>) => {
    ctx.logger.info({ user: ctx.payload.user }, ctx.payload.text);
};

router.on('chat:message', handler);
```

`SocketData` es la interfaz base que toda conexion lleva e incluye `connectionId` (ver [IDs de conexion](#ids-de-conexion)).

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

### Broadcast global

Enviar un mensaje a todos los sockets conectados:

```typescript
// Desde un handler
ctx.broadcast('notifications', { message: 'Nuevo usuario conectado' });

// Desde el driver directamente
socketDriver.broadcast('system:alert', { level: 'warning', msg: 'Mantenimiento' });
```

### Salas (Rooms)

Suscribir un socket a una sala con nombre y luego hacer broadcast solo a esa sala. Las salas son topicos nativos de pub/sub de Bun.

```typescript
// En un handler — unirse o salir de una sala
router.on('room:join', async (ctx) => {
    ctx.join(ctx.payload.room);          // suscribir este socket
    ctx.reply({ status: 'joined' });
});

router.on('room:leave', async (ctx) => {
    ctx.leave(ctx.payload.room);         // desuscribir este socket
    ctx.reply({ status: 'left' });
});

// Broadcast a una sala especifica desde el driver
socketDriver.broadcastTo('lobby', 'chat:message', { text: 'Hola lobby!' });
```

`broadcastTo(room, event, payload)` esta disponible en la instancia de `SocketDriver`. El `broadcast()` global sigue funcionando igual que antes.

## IDs de conexion

Cada conexion recibe un `connectionId` unico (UUID) en el momento del upgrade, almacenado en los datos tipados del socket (`ws.data.connectionId`). Es un identificador confiable por cliente — a diferencia de `remoteAddress`, esta garantizado ser unico entre reconexiones.

El `connectionId` se incluye en los payloads de los eventos del ciclo de vida:

```typescript
app.on('socket:connected', (payload) => {
    console.log(payload.connectionId); // ej. "a3f1c2d0-..."
    console.log(payload.id);           // direccion remota (informativo)
});
```

## Eventos del Ciclo de Vida

El driver emite eventos automaticamente:

- `socket:connected` — cuando se conecta un cliente (payload: `{ id, connectionId }`)
- `socket:disconnected` — cuando se desconecta un cliente (payload: `{ id, connectionId }`)
- `socket:${event}` — fallback cuando no hay handler en el router

```typescript
app.on('socket:connected', ({ connectionId }) => {
    console.log(`Cliente ${connectionId} conectado`);
});

app.on('socket:disconnected', ({ connectionId }) => {
    console.log(`Cliente ${connectionId} desconectado`);
});
```

## Errores

```typescript
import { SocketConnectionError, SocketMessageError } from '@iskra-bun/socket-kit';
// Se manejan internamente y se loguean
```
