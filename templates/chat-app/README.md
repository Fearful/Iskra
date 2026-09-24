# Chat App

Chat en tiempo real sobre WebSocket con **salas**, **presencia de usuarios**, **historial paginado** respaldado por KV store y **autenticacion en el handshake**. Incluye un cliente de prueba para desarrollo.

## Kits utilizados

- [`@iskra-bun/core`](https://iskra-docs.fly.dev/es/packages/core/) — Clase App, ciclo de vida, logger
- [`@iskra-bun/socket-kit`](https://iskra-docs.fly.dev/es/packages/socket-kit/) — WebSocket con router de eventos
- [`@iskra-bun/kv-kit`](https://iskra-docs.fly.dev/es/packages/kv-kit/) — Key-Value store para salas, presencia e historial

## Inicio rapido

```bash
# Desde la raiz del monorepo
bun install

cd templates/chat-app
cp .env.example .env   # opcional: ajustá CHAT_AUTH_SECRET y el puerto
bun start
```

El servidor de WebSocket levanta en `ws://localhost:3001`.

Para probar con dos clientes y ver la presencia y el broadcast en accion:

```bash
bun run client Ana general
# en otra terminal
bun run client Bob general
```

## Variables de entorno

| Variable | Descripcion | Default |
|----------|-------------|---------|
| `SOCKET_PORT` | Puerto del servidor WebSocket | `3001` |
| `CHAT_AUTH_SECRET` | Secreto compartido para validar el handshake | `dev-secret` |
| `KV_DRIVER` | Adaptador del KV store (`memory` o `redis`) | `memory` |

## Funcionalidades

### Autenticacion del handshake

El `SocketDriver` acepta la conexion sin credenciales, asi que la autenticacion se
resuelve en el **primer mensaje**. El cliente envia `auth { token }` y el servidor
valida el token contra `CHAT_AUTH_SECRET`. Hasta que el socket no este autenticado,
cualquier otro evento responde `{ ok: false, error: "unauthenticated" }`.

El formato de token del template es `token:<username>:<secret>` — usá el helper
`buildToken(username, secret)` de [`src/auth.ts`](./src/auth.ts) para construirlo.
En produccion reemplazá `verifyToken` por una verificacion de JWT firmado.

```jsonc
// Cliente → Servidor
{ "event": "auth", "payload": { "token": "token:Ana:dev-secret" } }
// Servidor → Cliente
{ "event": "auth:reply", "payload": { "ok": true, "userId": "u_ana", "username": "Ana" } }
```

### Salas (rooms)

Cada usuario vive en una sala. `join { room }` suscribe el socket al topic de esa
sala (via `ws.subscribe`), de modo que los mensajes solo llegan a los miembros de
la sala. `leave` desuscribe. El indice de salas conocidas se guarda en el KV store
bajo `rooms:index` y se consulta con el evento `rooms`.

### Presencia

La lista de miembros de cada sala se persiste en `room:<room>:members`. Al entrar o
salir un usuario, el servidor difunde un evento `presence` a la sala con la lista
actualizada y quien se sumó (`joined`) o se fue (`left`).

> Nota: la presencia se actualiza con `join`/`leave` explicitos. Para limpiar la
> presencia ante una desconexion abrupta, `src/events.ts` exporta `handleDisconnect`,
> pensado para engancharse al cierre del socket si extendés el driver. Los clientes
> de este template mandan `leave` ante `SIGINT`.

### Historial paginado

Los mensajes se guardan en `room:<room>:messages` (recortado a los ultimos 500). El
evento `history { before?, limit? }` pagina por **cursor temporal**: devuelve hasta
`limit` mensajes con `time < before`, en orden cronologico, junto con `hasMore` y un
`nextBefore` para seguir paginando hacia atras.

```jsonc
// Cliente → Servidor
{ "event": "history", "payload": { "limit": 20 } }
// Servidor → Cliente
{ "event": "history:reply", "payload": {
    "ok": true, "room": "general",
    "items": [ /* ChatMessage[] */ ],
    "total": 42, "hasMore": true, "nextBefore": 1718500000000
} }
```

## Protocolo de eventos

Todos los mensajes son JSON `{ event, payload }`. Las respuestas directas usan el
sufijo `:reply`; las difusiones (`message`, `presence`) llegan sin sufijo.

| Evento | Direccion | Payload | Descripcion |
|--------|-----------|---------|-------------|
| `auth` | C → S | `{ token }` | Autentica el socket (obligatorio primero) |
| `rooms` | C → S | `{}` | Lista las salas conocidas |
| `join` | C → S | `{ room }` | Entra a una sala; responde con presencia + historial |
| `message` | C → S | `{ text }` | Publica un mensaje en la sala actual |
| `history` | C → S | `{ before?, limit? }` | Pagina el historial de la sala |
| `leave` | C → S | `{}` | Sale de la sala actual |
| `message` | S → C | `{ room, id, username, text, time }` | Mensaje difundido a la sala |
| `presence` | S → C | `{ room, members, joined?, left? }` | Cambio de presencia en la sala |

## Estructura del proyecto

```
src/
├── main.ts        # Punto de entrada: config, secreto, registro de drivers
├── auth.ts        # Verificacion del token de handshake (verifyToken / buildToken)
├── rooms.ts       # Salas, presencia e historial sobre @iskra-bun/kv-kit
├── events.ts      # Router de eventos WebSocket (auth/join/message/history/leave)
└── client.ts      # Cliente de prueba (WebSocket nativo)
```

## Proximos pasos

- Reemplazar `verifyToken` por verificacion de JWT firmado
- Persistir mensajes en base de datos con [`@iskra-bun/db-kit`](https://iskra-docs.fly.dev/es/packages/db-kit/)
- Cambiar `KV_DRIVER` a `redis` para correr varias instancias del servidor
- Agregar un endpoint HTTP con [`@iskra-bun/web-kit`](https://iskra-docs.fly.dev/es/packages/web-kit/) para consultar historial

## Despliegue

Incluye `Dockerfile` con build multi-stage. Mas info en la [guia de despliegue](https://iskra-docs.fly.dev/es/guides/deployment/).
