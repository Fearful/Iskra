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
export API_KEYS="ana:author:$(openssl rand -hex 32)"   # un autor que puede publicar
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
| `API_KEYS` | Autores: `<authorId>:author:<clave>` separados por comas | — (sin claves nadie puede publicar) |

## Autenticacion

Leer el feed es publico; publicar exige la API key de un autor (`ApiKeyFeature` de
web-kit, ver [`src/auth.ts`](./src/auth.ts)) en `X-API-Key: <clave>` o
`Authorization: Bearer <clave>`, y sin ella responde `401`. El `authorId` del post sale
de la clave: el cuerpo solo lleva `content`. Cada autor puede publicar hasta 10 posts por
minuto (`RateLimitFeature`; despues, `429`), porque cada post se difunde a todos los
sockets conectados.

Las claves deben tener al menos 32 caracteres (`openssl rand -hex 32`) y una entrada mal
formada corta el arranque. Para usuarios con login, reemplazalas por el
[`AuthFeature`](https://iskra-docs.fly.dev/es/packages/web-kit/) y toma el autor de
`c.get('user').id`.

```bash
curl -X POST http://localhost:3000/feed \
  -H "X-API-Key: $CLAVE" -H 'content-type: application/json' \
  -d '{"content":"Hola feed"}'
```

## Endpoints HTTP

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| `GET` | `/feed` | Obtener los ultimos posts (publico) |
| `POST` | `/feed` | Publicar un post nuevo `{ content }` (hasta 280 caracteres; exige API key de autor) |

## Eventos WebSocket

| Evento | Direccion | Descripcion |
|--------|-----------|-------------|
| `feed:new-post` | Servidor → Cliente | Se emite cuando alguien publica un post nuevo |

## Como funciona

1. Un autor autenticado publica un post via `POST /feed`
2. El router HTTP emite un evento interno `feed:new-post`
3. El evento se propaga al `SocketDriver`, que lo broadcastea a todos los clientes WebSocket conectados
4. Los posts se guardan en memoria (maximo 100)

## Estructura del proyecto

```
src/
├── main.ts                          # Punto de entrada, conecta HTTP con Socket
├── app.config.ts                    # Configuracion con Zod
├── auth.ts                          # API keys de autores y limite de posts
└── interfaces/
    ├── http/
    │   └── router.ts                # Rutas HTTP y event bus
    └── socket/
        └── router.ts                # Handlers de eventos WebSocket
```

## Despliegue

El `Dockerfile` expone ambos puertos (HTTP y WebSocket). Mas info en la [guia de despliegue](https://iskra-docs.fly.dev/es/guides/deployment/).

```bash
# Desde la raiz del monorepo: el Dockerfile necesita todo el workspace
docker build -f templates/realtime-feed/Dockerfile -t realtime-feed .
docker run -p 3000:3000 -p 3001:3001 -e API_KEYS="..." realtime-feed
```
