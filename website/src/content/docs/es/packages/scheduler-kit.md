---
title: Scheduler Kit
description: Jobs periódicos en el propio proceso de la app, sin Redis.
---

`@iskra-bun/scheduler-kit` corre jobs cada N milisegundos dentro del proceso de la app: una sincronización de respaldo, una limpieza, un polling. No necesita Redis. Su `register()` y su `schedule()` son los del `WorkerManager` de [worker-kit](/es/packages/worker-kit/), así que una app que más adelante necesite una cola compartida cambia el constructor y conserva sus handlers.

```bash
bun add @iskra-bun/scheduler-kit
```

## Inicio rápido

```typescript
import { App } from '@iskra-bun/core';
import { WebPlugin, HealthCheckFeature } from '@iskra-bun/web-kit';
import { IntervalScheduler } from '@iskra-bun/scheduler-kit';

const jobs = new IntervalScheduler();

jobs.register('board-sync', async (job, { signal }) => {
    const res = await fetch('https://gitlab.example.com/api/v4/projects/1/issues', { signal });
    await saveIssues(await res.json());
    return { synced: 1 };
});
await jobs.schedule('board-sync', {}, { every: 3 * 60_000 }, { runOnStart: true, timeoutMs: 60_000 });

const app = new App({ name: 'board' });
app.register(
    new WebPlugin({
        features: [new HealthCheckFeature({ checks: { sync: jobs.healthCheck('board-sync') } })],
    }),
);
app.register(jobs); // después de los drivers que usan sus jobs
await app.start();
```

## Cómo se comportan las corridas

- **De a una.** Si una corrida sigue en curso cuando llega la siguiente, esa se saltea (`status().skipped` las cuenta). Las corridas de un mismo job nunca se superponen.
- **Un error no corta el loop.** Una corrida que lanza se loguea (`Job run failed`), queda como `lastError` y la siguiente llega a tiempo. Las corridas fallidas no se reintentan.
- **Timeout por corrida.** Pasado `timeoutMs` (por defecto, `every`), se aborta la `signal` de la corrida con un `TimeoutError`. Pasa la señal a `fetch()` y a las consultas para que el trabajo realmente se detenga; un handler que la ignora sigue corriendo, aparece como `stuck` y las corridas siguientes se saltean hasta que termine.
- **Apagado.** `stop()` (lo llama `app.stop()`) detiene todos los schedules, aborta la señal de las corridas en curso con un `AbortError` y las espera hasta `shutdownTimeoutMs` (5000 ms por defecto). Mantenlo por debajo del `shutdownTimeoutMs` de la App (10 s por defecto), que abarca a todos los drivers.
- **Orden de los drivers.** La App detiene los drivers en orden inverso al de registro: registra el scheduler después del servidor web y de la base que usan sus jobs, así los jobs terminan antes de que esos se cierren.
- **Un proceso.** El schedule vive en el proceso. Con varias instancias de la app, cada instancia corre el job; para que corra una sola vez entre instancias, usa los jobs repetibles de worker-kit.

## API

### `new IntervalScheduler(options?)`

| Opción | Por defecto | Descripción |
| :--- | :--- | :--- |
| `name` | `'IntervalScheduler'` | El nombre del driver en los logs |
| `shutdownTimeoutMs` | `5000` | Cuánto espera `stop()` las corridas en curso después de abortarlas |

### `register(name, handler)`

Define el handler del job `name`. El handler recibe el job (`{ id, name, data, attemptsMade }`; `id` es `<name>:<número de corrida>` y `attemptsMade` siempre es 0) y `{ signal }`. Lo que devuelve queda como el `result` de la última corrida.

### `schedule(name, data, repeat, options?)`

Corre el job cada `repeat.every` ms (un entero positivo), como mucho `repeat.limit` veces. Solo admite intervalos: rechaza un string cron. El handler tiene que estar registrado antes, y cada nombre se puede programar una sola vez.

| Opción | Por defecto | Descripción |
| :--- | :--- | :--- |
| `runOnStart` | `false` | Corre una vez cuando arranca el scheduler (enseguida si ya arrancó) |
| `timeoutMs` | `every` | Cuándo se aborta la señal de la corrida |

### `status(name)` / `statuses()`

```typescript
jobs.status('board-sync');
// {
//   name, every, running, stuck, runs, failures, consecutiveFailures, skipped,
//   lastRun: { startedAt, finishedAt, durationMs, ok, result },
//   lastSuccessAt, lastError: { at, name, message, code }, nextRunAt
// }
```

### `healthCheck(name, options?)`

Un check para el `HealthCheckFeature` de web-kit (`checks: { sync: jobs.healthCheck('board-sync') }`). Falla (`/health` responde 503) cuando:

- el job no está programado;
- su corrida en curso quedó trabada después del timeout;
- fallaron `maxConsecutiveFailures` corridas seguidas (3 por defecto);
- con `maxStalenessMs`, ninguna corrida tuvo éxito en ese tiempo (o en ese tiempo desde el arranque).

Sus `details` traen los contadores, la última corrida (`startedAt`, `durationMs`, `ok`) y el `name` y el `code` del último error. El mensaje del error queda en el log, porque puede traer URLs o tokens. El resultado de la última corrida se incluye solo con `includeResult: true`, porque puede tener datos.

## Pasar a worker-kit

Las dos clases implementan `JobScheduler` y las dos pasan `{ signal }` a los handlers:

```typescript
import type { JobScheduler } from '@iskra-bun/scheduler-kit';
import { WorkerManager } from '@iskra-bun/worker-kit';

const jobs: JobScheduler = process.env.REDIS_URL
    ? new WorkerManager({ connection: process.env.REDIS_URL })
    : new IntervalScheduler();

jobs.register('board-sync', syncBoard);
await jobs.schedule('board-sync', {}, { every: 180_000 });
```

Lo que no se traslada: `runOnStart`, `timeoutMs`, `status()` y `healthCheck()` son de scheduler-kit; los jobs de worker-kit tienen en cambio reintentos, `result()` y un evento de dead-letter.
