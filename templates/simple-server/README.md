# Simple Server

El template mas simple de Iskra. Un servidor HTTP minimo en ~18 lineas de codigo. Ideal para entender los conceptos basicos del framework.

## Kits utilizados

- [`@iskra-bun/core`](../../docs/core.md) — Clase App, ciclo de vida, logger
- [`@iskra-bun/web-kit`](../../docs/web-kit.md) — Servidor HTTP

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
- Sumar una base de datos con [`@iskra-bun/db-kit`](../../docs/db-kit.md)
- Agregar WebSockets con [`@iskra-bun/socket-kit`](../../docs/socket-kit.md)
- Revisar las [features del Web Kit](../../docs/web-kit.md) (auth, CORS, rate limit, etc.)

## Despliegue

Incluye `Dockerfile` con build multi-stage. Mas info en la [guia de despliegue](../../docs/despliegue.md).
