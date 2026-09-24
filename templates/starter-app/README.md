# Starter App

El template mas basico de Iskra. Un servidor web minimo con gestion de usuarios como ejemplo. Ideal para arrancar un proyecto nuevo desde cero.

## Kits utilizados

- [`@iskra-bun/core`](https://iskra-docs.fly.dev/es/packages/core/) — Clase App, ciclo de vida, logger
- [`@iskra-bun/web-kit`](https://iskra-docs.fly.dev/es/packages/web-kit/) — Servidor HTTP
- [`@iskra-bun/process-kit`](https://iskra-docs.fly.dev/es/packages/process-kit/) — Gestion de procesos externos

## Inicio rapido

```bash
# Desde la raiz del monorepo
bun install

cd templates/starter-app
bun start
```

El servidor levanta en `http://localhost:3000`.

## Variables de entorno

| Variable | Descripcion | Default |
|----------|-------------|---------|
| `PORT` | Puerto del servidor HTTP | `3000` |

## Endpoints

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| `GET` | `/users` | Listar todos los usuarios |
| `POST` | `/users` | Crear un usuario (body: `{ "name": "..." }`) |

## Estructura del proyecto

```
src/
├── main.ts                          # Punto de entrada
├── domain/
│   └── user.service.ts              # Logica de negocio
└── interfaces/
    └── http/
        └── router.ts                # Rutas HTTP con validacion Zod
```

## Proximos pasos

A partir de aca podes:

- Agregar una base de datos con [`@iskra-bun/db-kit`](https://iskra-docs.fly.dev/es/packages/db-kit/)
- Sumar WebSockets con [`@iskra-bun/socket-kit`](https://iskra-docs.fly.dev/es/packages/socket-kit/)
- Configurar cache con [`@iskra-bun/kv-kit`](https://iskra-docs.fly.dev/es/packages/kv-kit/)
- Revisar las [features del Web Kit](https://iskra-docs.fly.dev/es/packages/web-kit/) (auth, CORS, rate limit, etc.)
- Configurar el [sistema de configuracion](https://iskra-docs.fly.dev/es/configuration/) con `app.config.ts`

## Despliegue

Incluye `Dockerfile` con build multi-stage. Mas info en la [guia de despliegue](https://iskra-docs.fly.dev/es/guides/deployment/).
