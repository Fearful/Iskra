# Job Worker

Template para procesamiento de tareas en segundo plano con colas de trabajo. Ideal para operaciones asincronas como envio de emails o procesamiento de imagenes. Incluye **retry con backoff**, una **dead-letter queue** para jobs que agotan sus reintentos, y un endpoint HTTP de **health / monitoring**.

## Kits utilizados

- [`@iskra-bun/core`](https://iskra-docs.fly.dev/es/packages/core/) — Clase App, ciclo de vida, logger
- [`@iskra-bun/worker-kit`](https://iskra-docs.fly.dev/es/packages/worker-kit/) — Cola de jobs con BullMQ (Redis)
- [`@iskra-bun/web-kit`](https://iskra-docs.fly.dev/es/packages/web-kit/) — Endpoint HTTP de health/monitoring

## Requisitos

- **Redis** corriendo en `localhost:6379` (o la URL que configures)

```bash
# Si no tenes Redis, podes levantarlo con Docker
docker run -d -p 6379:6379 redis:alpine
```

## Inicio rapido

```bash
# Desde la raiz del monorepo
bun install

cd templates/job-worker
bun dev
```

El worker arranca, encola jobs de demostracion y levanta el endpoint de monitoring en `http://localhost:8080`.

```bash
curl http://localhost:8080/health
curl http://localhost:8080/metrics
```

## Variables de entorno

Copia `.env.example` a `.env`:

| Variable | Descripcion | Default |
|----------|-------------|---------|
| `CONCURRENCY` | Jobs procesados en paralelo | `2` |
| `QUEUE_NAME` | Nombre de la queue principal | `iskra-jobs` |
| `RETRY_ATTEMPTS` | Intentos antes de mandar a la DLQ | `3` |
| `BACKOFF_TYPE` | `fixed` o `exponential` | `exponential` |
| `BACKOFF_DELAY` | Delay base del backoff (ms) | `1000` |
| `DLQ_NAME` | Nombre de la dead-letter queue | `iskra-jobs-dlq` |
| `HTTP_PORT` | Puerto del endpoint de health/monitoring | `8080` |
| `REDIS_URL` | URL de conexion a Redis | `redis://localhost:6379` |
| `DEMO` | Encolar jobs de ejemplo (`false` para desactivar) | `true` |

## Retry y backoff

Los reintentos los maneja BullMQ via `defaultJobOptions` del `WorkerManager`. Por defecto: 3 intentos con backoff exponencial (1s, 2s, 4s...). Configurable con `RETRY_ATTEMPTS`, `BACKOFF_TYPE` y `BACKOFF_DELAY`.

## Dead-letter queue (DLQ)

Cuando un job agota todos sus reintentos, en lugar de perderse se mueve a una **segunda queue** (`iskra-jobs-dlq`). Ahi queda con su payload original, el numero de intentos y el error, listo para inspeccion o reproceso manual.

La logica vive en `src/dlq.ts` (`createDlq` + `moveToDlq`) y se conecta a los handlers desde `src/jobs.ts`. El handler `dead-letter` solo loguea; reemplazalo por persistencia en DB o una alerta segun tu caso.

## Health / Monitoring

El template registra un `WebPlugin` con un router de monitoring (`src/http/monitoring.ts`):

| Endpoint | Descripcion |
|----------|-------------|
| `GET /health` | Liveness simple, ideal para Docker/K8s |
| `GET /metrics` | Contadores en memoria: encolados, completados, fallidos, reintentos, dead-lettered, uptime |

> Las metricas son **por-instancia**. En un despliegue con varias replicas, cada una reporta lo suyo; la verdad agregada de la queue vive en Redis.

## Jobs incluidos

| Job | Descripcion |
|-----|-------------|
| `email.send` | Simula el envio de un email |
| `image.process` | Simula el procesamiento de una imagen |
| `flaky.task` | Falla siempre — demuestra retry/backoff y la DLQ |

## Estructura del proyecto

```
src/
├── main.ts                 # Punto de entrada: worker + DLQ + WebPlugin
├── app.config.ts           # Configuracion con Zod
├── jobs.ts                 # Handlers + wrapper retry/DLQ
├── dlq.ts                  # Dead-letter queue
├── metrics.ts              # Contadores en memoria (inmutables)
└── http/
    └── monitoring.ts       # Router de health/metrics
```

## Como agregar jobs nuevos

```typescript
// En src/jobs.ts, dentro de registerJobs(...)
worker.register(
    'mi-job.nombre',
    withRetryAndDlq(app, dlq, 'mi-job.nombre', async (job) => {
        // job.data: datos que pasaste al encolar
        // job.attemptsMade: numero de intento (0-indexed)
        await hacerAlgo(job.data);
    }),
);
```

```typescript
// Encolar desde cualquier parte que tenga acceso al worker
worker.enqueue('mi-job.nombre', { dato: 'valor' });
```

Para opciones avanzadas (prioridad, delay, backoff por job), revisa la [documentacion de Worker Kit](https://iskra-docs.fly.dev/es/packages/worker-kit/).

## Despliegue

El `Dockerfile` compila un binario con Bun y expone el puerto `8080` para el endpoint de health. Mas info en la [guia de despliegue](https://iskra-docs.fly.dev/es/guides/deployment/).
