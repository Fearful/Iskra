# @iskra-bun/worker-kit

Cola de jobs en segundo plano para Iskra basada en [BullMQ](https://docs.bullmq.io). Maneja handlers, reintentos, backoff y concurrencia.

## Instalacion

```bash
bun add @iskra-bun/worker-kit @iskra-bun/core
```

Requiere un Redis accesible (BullMQ).

## Uso rapido

```typescript
import { App } from '@iskra-bun/core'
import { WorkerManager } from '@iskra-bun/worker-kit'

const app = new App({ name: 'mi-worker' })
app.register(new WorkerManager({ queue: 'mis-jobs', concurrency: 2 }))

await app.start()
```

## Documentacion

Guia completa: [docs/worker-kit.md](../../docs/worker-kit.md)

## Licencia

AGPL-3.0-or-later
