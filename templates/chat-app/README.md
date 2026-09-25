# Chat App

Chat en tiempo real sobre WebSocket con **salas**, **presencia de usuarios**, **historial paginado** respaldado por KV store y **autenticacion en el handshake** con tokens firmados. Incluye un cliente de prueba para desarrollo.

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

El servidor de WebSocket levanta en `ws://localhost:3001`. Sin `CHAT_AUTH_SECRET` usa
un secreto de desarrollo y lo avisa; con `NODE_ENV=production` (la imagen Docker) no
arranca sin uno propio de al menos 32 caracteres.

Para probar con dos clientes y ver la presencia y el broadcast en accion, pedile un
token al servidor para cada usuario (`bun run token` usa el mismo `CHAT_AUTH_SECRET`
que el servidor; el cliente solo recibe el token):

```bash
CHAT_TOKEN=$(bun run --silent token ana) bun run client general
# en otra terminal
CHAT_TOKEN=$(bun run --silent token bob) bun run client general
```

## Variables de entorno

| Variable | Descripcion | Default |
|----------|-------------|---------|
| `SOCKET_PORT` | Puerto del servidor WebSocket | `3001` |
| `CHAT_AUTH_SECRET` | Secreto del servidor para firmar y verificar tokens (32+ caracteres, obligatorio en produccion) | `dev-secret` fuera de produccion |
| `KV_DRIVER` | Adaptador del KV store (`memory` o `redis`) | `memory` |

El cliente de prueba lee `CHAT_TOKEN` (el token emitido con `bun run token`) y `SOCKET_PORT`.

## Funcionalidades

### Autenticacion del handshake

El `SocketDriver` acepta la conexion sin credenciales, asi que la autenticacion se
resuelve en el **primer mensaje**. El cliente envia `auth { token }` y el servidor
verifica la firma y el vencimiento del token. Hasta que el socket no este autenticado,
cualquier otro evento responde `{ ok: false, error: "unauthenticated" }`.

Los tokens los **emite el servidor**: `issueToken(usuario, secreto)` de
[`src/auth.ts`](./src/auth.ts) firma `usuario + vencimiento` con HMAC-SHA256 y
`CHAT_AUTH_SECRET` (formato `v1.<usuario>.<vence>.<firma>`, 1 hora por defecto), y
`verifyToken` la comprueba en tiempo constante. Los clientes nunca conocen el secreto,
asi que no pueden armar un token a nombre de otro. En desarrollo los emite
`bun run token <usuario> [segundos]`; en una app real, tu servicio de login despues
de autenticar al usuario (o reemplazá `verifyToken` por la verificacion de tu JWT).

Los nombres de usuario se normalizan a minusculas (`a-z`, `0-9`, `_`, `-`, hasta 32):
`Ana` y `ana` son el mismo usuario. Tras 5 tokens invalidos en una conexion el
servidor la cierra (codigo `1008`), igual que una conexion que no se autentica en
10 segundos (`authTimeoutMs`), y un socket ya autenticado no puede cambiar de
identidad.

```jsonc
// Cliente → Servidor
{ "event": "auth", "payload": { "token": "v1.ana.1767225600.3q2-…" } }
// Servidor → Cliente
{ "event": "auth:reply", "payload": { "ok": true, "userId": "u_ana", "username": "ana" } }
```

El driver avisa al arrancar que acepta conexiones sin `allowedOrigins` ni `authenticate`:
aca la credencial es el token del primer mensaje, no una cookie, asi que otra pagina no
puede usar la sesion de un usuario (el ataque que ese aviso previene).

### Salas (rooms)

Cada usuario vive en una sala. `join { room }` suscribe el socket al topic `room:<sala>`
con `ctx.join`, de modo que los mensajes solo llegan a los miembros de la sala, y los
mensajes se difunden con `ctx.broadcast`. Los dos pasan por los hooks del
`SocketDriver` que configura [`src/main.ts`](./src/main.ts):

- `canJoin`: solo sockets autenticados, y solo a salas con nombre valido
  (`a-z`, `0-9`, `_`, `-`, hasta 64 caracteres). Las salas del template son publicas;
  para salas privadas cambiá `mayJoin` en [`src/events.ts`](./src/events.ts).
- `canPublish`: cada socket publica solo en la sala en la que esta.

`leave` desuscribe. El indice de salas conocidas se guarda en el KV store bajo
`rooms:index` (a lo sumo 100 salas: despues `join` a una sala nueva responde
`room_limit`) y se consulta, paginado, con `rooms { offset?, limit? }`, que lista solo
las salas a las que el usuario puede entrar.

### Presencia

La lista de miembros de cada sala se persiste en `room:<room>:members`. Al entrar o
salir un usuario, el servidor difunde un evento `presence` a la sala con la lista
actualizada y quien se sumó (`joined`) o se fue (`left`).

Si la conexion se corta sin `leave` (se cierra la pestaña, se cae la red),
`main.ts` escucha el evento `socket:disconnected` y llama a `handleDisconnect`, que saca
al usuario de la sala y avisa al resto.

### Historial paginado

Los mensajes (hasta 2 KB cada uno) se guardan en `room:<room>:messages`, recortado a
los ultimos 200. El
evento `history { before?, limit? }` pagina por **cursor**: cada mensaje tiene un `seq`
creciente dentro de la sala, y se devuelven hasta `limit` mensajes con `seq < before`, en
orden cronologico, junto con `hasMore` y un `nextBefore` para seguir paginando hacia atras
(con la hora como cursor se salteaban los mensajes del mismo milisegundo). Las escrituras a
una sala se serializan dentro del proceso; con varias instancias sobre Redis habria que
pasar a listas nativas de Redis.

```jsonc
// Cliente → Servidor
{ "event": "history", "payload": { "limit": 20 } }
// Servidor → Cliente
{ "event": "history:reply", "payload": {
    "ok": true, "room": "general",
    "items": [ /* ChatMessage[] */ ],
    "total": 42, "hasMore": true, "nextBefore": 22
} }
```

## Protocolo de eventos

Todos los mensajes son JSON `{ event, payload }`. Las respuestas directas usan el
sufijo `:reply`; las difusiones a una sala llegan con el sobre de `ctx.broadcast`:
`{ event: "room:<sala>", payload: { type, ... } }`.

| Evento | Direccion | Payload | Descripcion |
|--------|-----------|---------|-------------|
| `auth` | C → S | `{ token }` | Autentica el socket (obligatorio primero) |
| `rooms` | C → S | `{ offset?, limit? }` | Lista las salas a las que se puede entrar (`rooms`, `total`, `nextOffset`) |
| `join` | C → S | `{ room }` | Entra a una sala; responde con presencia + historial |
| `message` | C → S | `{ text }` | Publica un mensaje (hasta 2 KB) en la sala actual |
| `history` | C → S | `{ before?, limit? }` | Pagina el historial de la sala |
| `leave` | C → S | `{}` | Sale de la sala actual |
| `room:<sala>` | S → C | `{ type: "message", room, id, username, text, time, seq }` | Mensaje difundido a la sala |
| `room:<sala>` | S → C | `{ type: "presence", room, members, joined?, left? }` | Cambio de presencia en la sala |

## Estructura del proyecto

```
src/
├── main.ts        # Punto de entrada: secreto, SocketDriver con canJoin/canPublish, desconexiones
├── auth.ts        # Tokens firmados (issueToken / verifyToken) y validacion del secreto
├── issue-token.ts # `bun run token <usuario>`: emite un token del lado del servidor
├── rooms.ts       # Salas, presencia e historial sobre @iskra-bun/kv-kit
├── events.ts      # Router de eventos WebSocket y reglas de membresia
├── terminal.ts    # Limpia secuencias de escape antes de imprimir
└── client.ts      # Cliente de prueba (WebSocket nativo)
```

## Proximos pasos

- Emitir los tokens desde tu servicio de login (o reemplazar `verifyToken` por la verificacion de tu JWT)
- Salas privadas: cambiar `mayJoin` en `src/events.ts` por una consulta de miembros permitidos
- Persistir mensajes en base de datos con [`@iskra-bun/db-kit`](https://iskra-docs.fly.dev/es/packages/db-kit/)
- Cambiar `KV_DRIVER` a `redis` para correr varias instancias del servidor
- Agregar un endpoint HTTP con [`@iskra-bun/web-kit`](https://iskra-docs.fly.dev/es/packages/web-kit/) para consultar historial

## Despliegue

Incluye `Dockerfile` con build multi-stage. La imagen corre con `NODE_ENV=production`, asi
que necesita `CHAT_AUTH_SECRET` (`docker run -e CHAT_AUTH_SECRET=$(openssl rand -base64 48) ...`).
Mas info en la [guia de despliegue](https://iskra-docs.fly.dev/es/guides/deployment/).
