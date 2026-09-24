# Realtime Feed

Template para una aplicacion de feed social con actualizaciones en tiempo real. Combina una API HTTP para publicar posts con WebSockets para broadcastear las novedades a todos los clientes conectados.

## Kits utilizados

- [`@iskra-bun/core`](https://iskra-docs.fly.dev/es/packages/core/) — Clase App, ciclo de vida, eventos
- [`@iskra-bun/web-kit`](https://iskra-docs.fly.dev/es/packages/web-kit/) — Servidor HTTP con Hono
- [`@iskra-bun/socket-kit`](https://iskra-docs.fly.dev/es/packages/socket-kit/) — WebSocket nativo de Bun
- [`@iskra-bun/kv-kit`](https://iskra-docs.fly.dev/es/packages/kv-kit/) — Almacenamiento en memoria

## Inicio rapido

```bash
# Desde la raiz del monorepo
bun install

cd templates/realtime-feed
bun dev
```

- API HTTP en `http://localhost:3000`
- WebSocket en `ws://localhost:3001`

## Variables de entorno

Copia `.env.example` a `.env`:

| Variable | Descripcion | Default |
|----------|-------------|---------|
| `PORT` | Puerto del servidor HTTP | `3000` |
| `SOCKET_PORT` | Puerto del servidor WebSocket | `3001` |

## Endpoints HTTP

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| `GET` | `/feed` | Obtener los ultimos posts |
| `POST` | `/feed` | Publicar un post nuevo |

## Eventos WebSocket

| Evento | Direccion | Descripcion |
|--------|-----------|-------------|
| `feed:new-post` | Servidor → Cliente | Se emite cuando alguien publica un post nuevo |

## Como funciona

1. Un cliente publica un post via `POST /feed`
2. El router HTTP emite un evento interno `feed:new-post`
3. El evento se propaga al `SocketDriver`, que lo broadcastea a todos los clientes WebSocket conectados
4. Los posts se guardan en memoria (maximo 100)

## Estructura del proyecto

```
src/
├── main.ts                          # Punto de entrada, conecta HTTP con Socket
├── app.config.ts                    # Configuracion con Zod
└── interfaces/
    ├── http/
    │   └── router.ts                # Rutas HTTP y event bus
    └── socket/
        └── router.ts                # Handlers de eventos WebSocket
```

## Despliegue

El `Dockerfile` expone ambos puertos (HTTP y WebSocket). Mas info en la [guia de despliegue](https://iskra-docs.fly.dev/es/guides/deployment/).

```bash
docker build -t realtime-feed .
docker run -p 3000:3000 -p 3001:3001 realtime-feed
```
