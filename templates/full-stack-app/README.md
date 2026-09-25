# Full Stack App

App completa que combina todos los kits de Iskra: servidor HTTP con documentacion OpenAPI, WebSocket, base de datos (SQLite + Oracle opcional), KV store, y gestion de procesos externos. Ideal para entender como se integran todas las piezas del framework.

## Kits utilizados

- [`@iskra-bun/core`](https://iskra-docs.fly.dev/es/packages/core/) — Clase App, ciclo de vida, logger
- [`@iskra-bun/web-kit`](https://iskra-docs.fly.dev/es/packages/web-kit/) — Servidor HTTP con OpenAPI
- [`@iskra-bun/socket-kit`](https://iskra-docs.fly.dev/es/packages/socket-kit/) — WebSocket con router de eventos
- [`@iskra-bun/kv-kit`](https://iskra-docs.fly.dev/es/packages/kv-kit/) — Key-Value store en memoria
- [`@iskra-bun/db-kit`](https://iskra-docs.fly.dev/es/packages/db-kit/) — Base de datos SQL con Drizzle ORM
- [`@iskra-bun/db-oracle`](https://iskra-docs.fly.dev/es/packages/db-kit/) — Oracle Database (opcional)
- [`@iskra-bun/process-kit`](https://iskra-docs.fly.dev/es/packages/process-kit/) — Gestion de procesos externos

## Inicio rapido

```bash
# Desde la raiz del monorepo
bun install

cd templates/full-stack-app
bun start
```

El servidor HTTP levanta en `http://localhost:3000` y el WebSocket en `ws://localhost:3001`.

La documentacion OpenAPI esta disponible en `http://localhost:3000/doc`.

## Variables de entorno

| Variable | Descripcion | Default |
|----------|-------------|---------|
| `PORT` | Puerto del servidor HTTP | `3000` |
| `SOCKET_PORT` | Puerto del servidor WebSocket | `3001` |
| `DATABASE_URL` | Ruta del archivo SQLite (o `:memory:`) | `:memory:` |
| `ORACLE_USER` | Usuario de Oracle (opcional): uno propio de la app con permisos minimos, nunca `SYSTEM`/`SYS` | — |
| `ORACLE_PASSWORD` | Password de Oracle (opcional) | — |
| `ORACLE_CONNECTION_STRING` | Connection string de Oracle (opcional) | — |

## Endpoints HTTP

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| `GET` | `/` | Mensaje de bienvenida |
| `GET` | `/status` | Estado de la app (uptime, workers, ultimo mensaje) |
| `GET` | `/db-test` | Test de conexion a la base de datos |
| `GET` | `/doc` | Documentacion OpenAPI |

## Eventos WebSocket

| Evento | Direccion | Descripcion |
|--------|-----------|-------------|
| `chat:message` | Cliente → Servidor | Enviar `{ text }` (1 a 500 caracteres): se guarda solo el texto en KV y responde `{ ok, message }` |

`GET /status` muestra el ultimo mensaje a cualquiera y el socket no pide autenticacion,
asi que del payload se guarda solo un texto acotado (antes, cualquier JSON de hasta 16 KiB).

## Procesos externos

El template incluye un worker de ejemplo (`src/scripts/worker.js`) que envia pings cada 5 segundos via stdio. El estado del worker se puede consultar en `GET /status`.

## Estructura del proyecto

```
src/
├── main.ts                              # Punto de entrada (orquestacion)
├── app.config.ts                        # Configuracion centralizada
├── interfaces/
│   ├── http/
│   │   └── router.ts                    # Rutas HTTP
│   └── socket/
│       └── events.ts                    # Handlers de WebSocket
└── scripts/
    └── worker.js                        # Worker de ejemplo (proceso externo)
```

## Proximos pasos

A partir de aca podes:

- Agregar mas rutas HTTP con validacion Zod
- Agregar soporte de salas en WebSocket
- Configurar el KV store con Redis para produccion
- Agregar migraciones con [Drizzle Kit](https://iskra-docs.fly.dev/es/guides/migrations/)
- Revisar las [features del Web Kit](https://iskra-docs.fly.dev/es/packages/web-kit/) (auth, CORS, rate limit, etc.)

## Despliegue

Incluye `Dockerfile` con build multi-stage. El worker.js se copia por separado ya que no se incluye en el binario compilado. Mas info en la [guia de despliegue](https://iskra-docs.fly.dev/es/guides/deployment/).
