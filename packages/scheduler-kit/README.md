# @iskra-bun/scheduler-kit

Jobs periodicos en el propio proceso de la app, sin Redis: una sincronizacion de respaldo, una limpieza, un polling. Una corrida en curso hace saltear la siguiente, un error se loguea sin cortar el loop, cada corrida tiene timeout con `AbortSignal`, y el apagado espera la corrida actual. `register()` y `schedule()` son los de `WorkerManager` (worker-kit), para pasar a una cola con Redis cambiando el constructor.

## Instalacion

```bash
bun add @iskra-bun/scheduler-kit
```

## Uso rapido

```typescript
import { IntervalScheduler } from '@iskra-bun/scheduler-kit'

const jobs = new IntervalScheduler()
jobs.register('board-sync', async (job, { signal }) => {
  await syncBoard({ signal })
})
await jobs.schedule('board-sync', {}, { every: 180_000 }, { runOnStart: true })

app.register(jobs) // despues de los drivers que usan sus jobs
// HealthCheckFeature({ checks: { sync: jobs.healthCheck('board-sync') } })
```

Documentacion completa: https://iskra-docs.fly.dev/packages/scheduler-kit/

## Licencia

AGPL-3.0-or-later
