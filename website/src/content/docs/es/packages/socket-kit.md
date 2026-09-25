---
title: Socket Kit
description: WebSocket nativo de Bun para comunicacion en tiempo real.
---

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
    // ctx.broadcast() — publicar a un topico (sujeto a canPublish)
    // ctx.join(room)  — suscribir este socket a una sala (sujeto a canJoin)
    // ctx.leave(room) — desuscribir este socket de una sala
});
```

### Handlers tipados

`on<TPayload>()` es generico, asi que `ctx.payload` queda tipado sin ningun cast en el punto de registro. `SocketContext` y `SocketHandler` aceptan dos genericos — el tipo del payload y el tipo de los datos por conexion:

```typescript
import type { SocketContext, SocketHandler, SocketData } from '@iskra-bun/socket-kit';

interface ChatPayload { text: string; user: string }

// Extender SocketData para agregar campos por conexion
interface MyData extends SocketData {
    userId: string;
}

// ctx.payload es ChatPayload aqui — sin necesidad de `as SocketHandler`.
router.on<ChatPayload>('chat:message', async (ctx) => {
    ctx.logger.info({ user: ctx.payload.user }, ctx.payload.text);
});

// Ambos genericos: payload tipado y ws.data tipado.
const handler: SocketHandler<ChatPayload, MyData> = async (ctx) => {
    ctx.logger.info({ id: ctx.socket.data.userId }, ctx.payload.text);
};

router.on<ChatPayload, MyData>('chat:typed', handler);
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

### Frame que reciben los clientes

Todo frame del servidor al cliente — `ctx.reply`, `ctx.broadcast`, `driver.broadcast` y `driver.broadcastTo` — usa el mismo sobre:

```json
{ "event": "<topico-o-evento>", "payload": <datos> }
```

Para `ctx.broadcast(topic, data)` y `driver.broadcastTo(room, event, payload)`, el campo `event` lleva el nombre del topico/evento y `payload` lleva tus datos. Los clientes deben leer siempre `data.event` y `data.payload` en lugar de asumir datos crudos.

## Broadcast

### Broadcast global

Enviar un mensaje a todos los sockets conectados (todos quedan suscritos al topico `global` al conectarse):

```typescript
// Desde un handler — envuelto como { event: 'notifications', payload: {...} }
ctx.broadcast('notifications', { message: 'Nuevo usuario conectado' });

// Desde el driver directamente
socketDriver.broadcast('system:alert', { level: 'warning', msg: 'Mantenimiento' });
```

### Salas (Rooms)

Suscribir un socket a una sala con nombre y luego hacer broadcast solo a esa sala. Las salas son topicos nativos de pub/sub de Bun.

```typescript
// En un handler — unirse o salir de una sala
router.on('room:join', async (ctx) => {
    ctx.join(ctx.payload.room);          // suscribir este socket (sujeto a canJoin)
    ctx.reply({ status: 'joined' });
});

router.on('room:leave', async (ctx) => {
    ctx.leave(ctx.payload.room);         // desuscribir este socket
    ctx.reply({ status: 'left' });
});

// Broadcast a una sala especifica desde el driver
socketDriver.broadcastTo('lobby', 'chat:message', { text: 'Hola lobby!' });
```

`broadcastTo(room, event, payload)` esta disponible en la instancia de `SocketDriver`.

#### Salas por conexion (de usuario)

No existe un tipo especial de "sala de usuario" — una sala por conexion es simplemente una sala nombrada con el `connectionId` del socket. Como `connectionId` es unico por conexion, suscribir un socket a una sala con su propio id aisla los mensajes a esa unica conexion:

```typescript
router.on('subscribe:me', async (ctx) => {
    ctx.join(ctx.socket.data.connectionId); // sala privada para esta conexion
    ctx.reply({ status: 'ok' });
});

// Mas adelante, apuntar solo a esa conexion desde el driver:
socketDriver.broadcastTo(connectionId, 'inbox:new', { unread: 3 });
```

## Defaults

De fabrica el driver esta abierto: esta pensado para cerrarlo con estas opciones antes de exponerlo a usuarios.

| Que | Default | Opcion para restringirlo |
| --- | --- | --- |
| Quien puede conectarse | cualquier origen, sin autenticacion (se registra un warning al arrancar) | `allowedOrigins`, `authenticate` |
| A que salas puede unirse un cliente | a cualquiera | `canJoin` |
| En que topicos puede publicar un cliente | en cualquiera, `global` (todos los sockets) incluido | `canPublish` |
| Que eventos sin handler llegan al bus de la app | todos, como `socket:<evento>` | `allowedEvents` |

El tamano de frame (`maxPayloadLength`) y la tasa de mensajes (`rateLimit`) si estan acotados por defecto; ver [Proteccion contra DoS](#proteccion-contra-dos).

## Handshake: origen y autenticacion

Sin configuracion, el driver acepta conexiones de cualquier origen y sin autenticar (y lo avisa con un warning al arrancar). Un navegador envia las cookies del usuario en el handshake de WebSocket, asi que cualquier sitio podria abrir una conexion en su nombre (cross-site WebSocket hijacking).

```typescript
const driver = new SocketDriver({
    port: 3001,
    router,
    // Handshakes con otro header Origin reciben 403; sin Origin (clientes no-navegador) se aceptan.
    allowedOrigins: ['https://app.example.com'],
    // Lo que devuelva queda en ctx.socket.data.auth; null/undefined/false (o un throw) => 401.
    authenticate: (req) => redeemTicket(new URL(req.url).searchParams.get('ticket')),
});
```

### Como enviar la credencial

Un navegador no puede definir headers en un WebSocket, asi que la credencial viaja en la URL, en un subprotocolo o en una cookie. La URL del handshake termina en los logs de acceso de cada proxy y balanceador del camino, y en el historial del navegador: no pongas ahi un token de larga vida (un token de sesion, un JWT, una API key). En orden de preferencia:

- **Un ticket de corta vida y de un solo uso.** Una ruta HTTP autenticada emite un ticket aleatorio valido por unos segundos, el cliente se conecta con el, y `authenticate` lo canjea una sola vez, asi que una URL que quedo en un log no sirve para nada:

```typescript
// Una instancia; con varias, guarda los tickets en un store compartido con
// expiracion y leelos y borralos atomicamente (Redis SET … EX y GETDEL).
const tickets = new Map<string, { userId: string; expires: number }>();

// Lado HTTP, detras de tu auth: un ticket valido por 30 s.
app.post('/api/ws-ticket', requireAuth(kernel), (c) => {
    const ticket = crypto.randomUUID();
    tickets.set(ticket, { userId: c.get('user').id, expires: Date.now() + 30_000 });
    return c.json({ ticket });
});

// Lado socket: cada ticket sirve una vez.
function redeemTicket(ticket: string | null) {
    const entry = ticket ? tickets.get(ticket) : undefined;
    if (ticket) tickets.delete(ticket);
    return entry && entry.expires > Date.now() ? { userId: entry.userId } : null;
}

// Navegador
const { ticket } = await (await fetch('/api/ws-ticket', { method: 'POST' })).json();
const ws = new WebSocket(`wss://app.example.com/ws?ticket=${ticket}`);
```

- **El header `Sec-WebSocket-Protocol`**, que el navegador si permite definir: `new WebSocket(url, ['bearer', token])`. Bun responde con el primer protocolo (`bearer`), y `authenticate` lee el token de `req.headers.get('sec-websocket-protocol')` (un subprotocolo no puede contener `/`, `=`, `,` ni espacios: usa un token base64url o hex). Los proxies rara vez registran este header, pero el token sigue siendo de larga vida: un ticket es mejor.
- **La cookie de sesion**, que el navegador envia solo: entonces define `allowedOrigins`, porque esa cookie es justamente lo que le permite a otro sitio conectarse como el usuario.

Una app que en cambio se autentica en el primer mensaje (un evento `auth` con un token) tiene que cerrar las conexiones que no lo hacen: una que nunca manda nada queda abierta mientras su cliente conteste los pings. Dale a cada conexion un plazo con `driver.close(connectionId, code?, reason?)`, que devuelve `false` si la conexion ya no esta:

```typescript
app.on('socket:connected', ({ payload: { connectionId } }) => {
    setTimeout(() => {
        if (!sessions.has(connectionId)) driver.close(connectionId, 1008, 'Authentication timeout');
    }, 10_000);
});
```

La plantilla [`chat-app`](https://github.com/fearful/iskra/tree/main/templates/chat-app) lo hace (`handleConnect`).

## Autorizacion

El driver acepta hooks opcionales `canJoin` y `canPublish` que controlan las uniones a salas y las publicaciones por conexion. Ambos permiten todo por defecto cuando se omiten: cualquier cliente puede unirse a cualquier sala (incluida la sala por conexion de otro usuario) y publicar en cualquier topico, `global` incluido, hasta que los definas.

```typescript
import { SocketDriver } from '@iskra-bun/socket-kit';
import type { CanJoin, CanPublish } from '@iskra-bun/socket-kit';

// (connection, room) => boolean — devolver false para denegar la union
const canJoin: CanJoin = (connection, room) => {
    // p. ej. permitir solo la sala propia por conexion o salas publicas
    return room === 'public' || room === connection.data.connectionId;
};

// (connection, topic) => boolean — devolver false para denegar la publicacion
const canPublish: CanPublish = (connection, topic) => topic !== 'global';

const driver = new SocketDriver({ port: 3001, router, canJoin, canPublish });
```

- `canJoin` controla `ctx.join(room)`. Cuando devuelve `false`, el socket **no** se suscribe y se registra un warning.
- `canPublish` controla `ctx.broadcast(topic, data)`. Cuando devuelve `false`, el frame **no** se publica.
- Ambos hooks reciben el `ServerWebSocket<SocketData>` de la conexion, asi que puedes leer `connection.data.connectionId` (y cualquier campo propio de `SocketData`, como un `userId` autenticado) para decidir.
- `driver.broadcast` y `driver.broadcastTo` son llamadas del lado del servidor y **no** estan sujetas a estos hooks — solo los caminos iniciados por el cliente (`ctx.join` / `ctx.broadcast`) se controlan.

## Proteccion contra DoS

El driver acota el trabajo entrante de dos formas, ambas configurables en `SocketDriverOptions`:

| Opcion | Por defecto | Efecto |
| --- | --- | --- |
| `maxPayloadLength` | `16 * 1024` (16 KiB) | Tamano maximo del frame entrante en bytes, conectado a `websocket.maxPayloadLength` de Bun. Un frame mas grande hace que Bun cierre la conexion, acotando el costo de `JSON.parse`. |
| `rateLimit` | `100` | Maximo de mensajes entrantes aceptados por conexion por ventana. Los frames sobre el presupuesto se descartan (el handler no se invoca) y se registra un warning. |
| `rateWindowMs` | `1000` | Duracion de la ventana de rate-limit en milisegundos. El presupuesto se reinicia al terminar la ventana. |

```typescript
const driver = new SocketDriver({
    port: 3001,
    router,
    maxPayloadLength: 32 * 1024, // frames de 32 KiB
    rateLimit: 50,               // 50 mensajes...
    rateWindowMs: 1000,          // ...por segundo, por conexion
});
```

El limite de frame resuelto se puede leer como `driver.maxPayloadLength`. El conteo del rate-limit es por `connectionId` y se limpia cuando la conexion se cierra.

### Lista blanca de eventos de fallback

Los mensajes sin handler en el router caen al bus de eventos de la App como `socket:${event}`. Define `allowedEvents` para restringir que nombres de eventos no reconocidos pueden reemitirse; los nombres fuera del conjunto se descartan (y se registran). Si se omite `allowedEvents`, todos los eventos de fallback se reemiten.

```typescript
const driver = new SocketDriver({
    port: 3001,
    router,
    allowedEvents: ['presence:ping', 'cursor:move'],
});
```

## IDs de conexion

Una request que no es un handshake WebSocket (un `GET` comun de un navegador o de un health check) recibe `426 Upgrade Required`.

Cada conexion recibe un `connectionId` unico (UUID) en el momento del upgrade, almacenado en los datos tipados del socket (`ws.data.connectionId`). Es un identificador confiable por cliente — a diferencia de `remoteAddress`, esta garantizado ser unico entre reconexiones.

El `connectionId` es el payload de los eventos del ciclo de vida:

```typescript
app.on('socket:connected', (ctx) => {
    console.log(ctx.payload.connectionId); // ej. "a3f1c2d0-..."
});
```

## Eventos del Ciclo de Vida

El driver emite eventos automaticamente:

- `socket:connected` — cuando se conecta un cliente (payload: `{ connectionId }`)
- `socket:disconnected` — cuando se desconecta un cliente (payload: `{ connectionId }`)
- `socket:${event}` — fallback cuando no hay handler en el router (sujeto a `allowedEvents`); los nombres reservados `connected` y `disconnected` nunca se reemiten desde un cliente

```typescript
app.on('socket:connected', (ctx) => {
    console.log(`Cliente ${ctx.payload.connectionId} conectado`);
});

app.on('socket:disconnected', (ctx) => {
    console.log(`Cliente ${ctx.payload.connectionId} desconectado`);
});
```

## Errores

```typescript
import { SocketConnectionError, SocketMessageError } from '@iskra-bun/socket-kit';
// Se manejan internamente y se loguean.
```
