# Python Data Processor

Template que muestra como integrar scripts de Python con una app Iskra. Usa el Process Kit para levantar un subproceso Python y comunicarse con el via IPC (JSON sobre stdin/stdout), exponiendo los resultados a traves de una API HTTP.

## Kits utilizados

- [`@iskra-bun/core`](https://iskra-docs.fly.dev/es/packages/core/) — Clase App, ciclo de vida, eventos
- [`@iskra-bun/process-kit`](https://iskra-docs.fly.dev/es/packages/process-kit/) — Gestion de procesos externos
- [`@iskra-bun/web-kit`](https://iskra-docs.fly.dev/es/packages/web-kit/) — Servidor HTTP con Hono

## Requisitos

- **Python 3** instalado y disponible en el PATH

## Inicio rapido

```bash
# Desde la raiz del monorepo
bun install

cd templates/python-data-processor
bun dev
```

El servidor levanta en `http://localhost:3000`.

## Variables de entorno

| Variable | Descripcion | Default |
|----------|-------------|---------|
| `PORT` | Puerto del servidor HTTP | `3000` |

## Endpoints

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| `POST` | `/process` | Enviar datos al proceso Python para procesar |
| `GET` | `/health` | Estado del servicio y cantidad de requests pendientes |

## Como funciona

1. Al arrancar, Iskra levanta el script Python como subproceso usando el Process Kit (modo `stdio`)
2. Cuando llega un request HTTP a `/process`, se le envia al proceso Python via stdin como JSON
3. Python procesa los datos y responde por stdout
4. La respuesta se devuelve al cliente HTTP

La comunicacion usa un esquema de request-response con `requestId` para matchear respuestas con sus requests originales. Tiene timeout configurable (30s por defecto).

## Estructura del proyecto

```
src/
├── main.ts              # Punto de entrada, IPC y rutas HTTP
└── app.config.ts        # Configuracion de procesos y web
scripts/
└── processor.py         # Script Python que procesa los datos
```

## Despliegue

El `Dockerfile` incluido instala Python 3 en el container. Mas info en la [guia de despliegue](https://iskra-docs.fly.dev/es/guides/deployment/).

```bash
docker build -t python-data-processor .
docker run -p 3000:3000 python-data-processor
```
