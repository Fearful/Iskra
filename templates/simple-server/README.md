# Simple Server

El template mas simple de Iskra. Un servidor HTTP minimo en ~18 lineas de codigo. Ideal para entender los conceptos basicos del framework.

## Kits utilizados

- [`@iskra-bun/core`](https://iskra-docs.fly.dev/es/packages/core/) — Clase App, ciclo de vida, logger
- [`@iskra-bun/web-kit`](https://iskra-docs.fly.dev/es/packages/web-kit/) — Servidor HTTP

## Inicio rapido

```bash
# Desde la raiz del monorepo
bun install

cd templates/simple-server
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
| `GET` | `/` | Mensaje de bienvenida |

## Estructura del proyecto

```
src/
└── main.ts       # Punto de entrada (servidor completo)
```

## Proximos pasos

A partir de aca podes:

- Agregar mas rutas y handlers
- Sumar una base de datos con [`@iskra-bun/db-kit`](https://iskra-docs.fly.dev/es/packages/db-kit/)
- Agregar WebSockets con [`@iskra-bun/socket-kit`](https://iskra-docs.fly.dev/es/packages/socket-kit/)
- Revisar las [features del Web Kit](https://iskra-docs.fly.dev/es/packages/web-kit/) (auth, CORS, rate limit, etc.)

## Despliegue

Incluye `Dockerfile` con build multi-stage. Mas info en la [guia de despliegue](https://iskra-docs.fly.dev/es/guides/deployment/).
