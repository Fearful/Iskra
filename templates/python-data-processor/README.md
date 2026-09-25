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
| `MAX_IN_FLIGHT` | Pedidos enviados a Python sin respuesta todavia; despues, `503` | `8` |
| `PROCESS_TIMEOUT_MS` | Cuanto espera un pedido HTTP a Python; despues, `504` | `30000` |

## Endpoints

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| `POST` | `/process` | Enviar un objeto JSON (`Content-Type: application/json`, hasta 256 KiB) al proceso Python |
| `GET` | `/health` | Estado del servicio, si Python esta listo y cantidad de requests pendientes |

## Como funciona

1. Al arrancar, Iskra levanta el script Python como subproceso usando el Process Kit (modo `stdio`)
2. Cuando llega un request HTTP a `/process`, se le envia al proceso Python via stdin como JSON
3. Python procesa los datos y responde por stdout
4. La respuesta se devuelve al cliente HTTP

La comunicacion usa un esquema de request-response con `requestId` para matchear respuestas con sus requests originales. Tiene timeout configurable (30s por defecto).

### Limites

Hay un solo proceso Python y atiende de a un pedido, asi que el servicio se protege:

- **Pedidos en vuelo:** a lo sumo `MAX_IN_FLIGHT` enviados sin respuesta; el siguiente
  recibe `503` con `Retry-After`. Un pedido que vence (`504`) sigue contando hasta que
  Python lo contesta, porque sigue en su cola; cada pedido lleva un `deadline` y Python
  descarta sin procesar los que ya vencieron.
- **Solo JSON:** `/process` acepta objetos JSON con `Content-Type: application/json`
  (`415` si no) de hasta 256 KiB.
- **Caidas:** el proceso se reinicia solo (`restartOnCrash`, con espera creciente). Si
  termina, los pedidos pendientes fallan en el acto con `503`, y `/process` responde `503`
  hasta que el proceso nuevo imprime su linea `{"type": "status"}` de arranque (si
  cambias el script, conservala).
- **Errores:** el texto de una excepcion de Python queda en el log; el cliente recibe
  `502 Processing failed`.

`/process` no tiene autenticacion: dejalo en una red interna o agregale un feature de
autenticacion de web-kit (por ejemplo `ApiKeyFeature`) antes de exponerlo.

## Estructura del proyecto

```
src/
├── main.ts              # Punto de entrada
├── processor.ts         # IPC con Python (limites, timeouts, caidas) y rutas HTTP
├── app.config.ts        # Configuracion de procesos y web
└── scripts/
    └── process.py       # Script Python que procesa los datos
```

## Despliegue

El `Dockerfile` incluido instala Python 3 en el container. Mas info en la [guia de despliegue](https://iskra-docs.fly.dev/es/guides/deployment/).

```bash
# Desde la raiz del monorepo: el Dockerfile necesita todo el workspace
docker build -f templates/python-data-processor/Dockerfile -t python-data-processor .
docker run -p 3000:3000 python-data-processor
```
