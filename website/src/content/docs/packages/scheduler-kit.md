---
title: Scheduler Kit
description: Periodic jobs in the app's own process, without Redis.
---

`@iskra-bun/scheduler-kit` runs jobs every N milliseconds inside the app's process: a backup sync, a cleanup, a poll. It needs no Redis. Its `register()` and `schedule()` are the ones of [worker-kit](/packages/worker-kit/)'s `WorkerManager`, so an app that later needs a shared queue changes the constructor and keeps its handlers.

```bash
bun add @iskra-bun/scheduler-kit
```

## Quick Start

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
app.register(jobs); // after the drivers its jobs use
await app.start();
```

## How runs behave

- **One at a time.** When a run is still in progress at the next tick, that tick is skipped (`status().skipped` counts them). Runs of the same job never overlap.
- **Errors do not stop the schedule.** A run that throws is logged (`Job run failed`), kept as `lastError`, and the next run comes on time. Failed runs are not retried.
- **Timeout per run.** After `timeoutMs` (default: `every`) the run's `signal` is aborted with a `TimeoutError`. Pass the signal to `fetch()` and to your queries so the work actually stops; a handler that ignores it keeps running, shows as `stuck`, and its next runs are skipped until it returns.
- **Shutdown.** `stop()` (called by `app.stop()`) stops every schedule, aborts the signal of the runs in progress with an `AbortError`, and waits for them up to `shutdownTimeoutMs` (default 5000 ms). Keep that under the App's `shutdownTimeoutMs` (10 s by default), which covers every driver.
- **Driver order.** The App stops drivers in reverse registration order: register the scheduler after the web server and the database its jobs use, so the jobs end before those close.
- **One process.** The schedule lives in the process. With several instances of the app, every instance runs the job; use worker-kit's repeatable jobs when it must run once across instances.

## API

### `new IntervalScheduler(options?)`

| Option | Default | Description |
| :--- | :--- | :--- |
| `name` | `'IntervalScheduler'` | The driver's name in the logs |
| `shutdownTimeoutMs` | `5000` | How long `stop()` waits for the runs in progress after aborting them |

### `register(name, handler)`

Sets the handler of the job `name`. The handler gets the job (`{ id, name, data, attemptsMade }`; `id` is `<name>:<run number>`, `attemptsMade` is always 0) and `{ signal }`. What it returns is kept as the last run's `result`.

### `schedule(name, data, repeat, options?)`

Runs the job every `repeat.every` ms (a positive integer), at most `repeat.limit` times. Only intervals are supported: a cron string is refused. The handler must be registered first, and a name can be scheduled once.

| Option | Default | Description |
| :--- | :--- | :--- |
| `runOnStart` | `false` | Run once when the scheduler starts (right away when it already did) |
| `timeoutMs` | `every` | When the run's signal is aborted |

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

A check for web-kit's `HealthCheckFeature` (`checks: { sync: jobs.healthCheck('board-sync') }`). It fails (`/health` answers 503) when:

- the job is not scheduled;
- its run in progress is stuck past its timeout;
- `maxConsecutiveFailures` runs failed in a row (default 3);
- with `maxStalenessMs`, no run succeeded that long (or that long after start).

Its `details` carry the counters, the last run (`startedAt`, `durationMs`, `ok`) and the last error's `name` and `code`. The error's message stays in the log: it can hold URLs or tokens. The last run's result is included only with `includeResult: true`, since it may hold data.

## Moving to worker-kit

Both classes implement `JobScheduler`, and both pass `{ signal }` to handlers:

```typescript
import type { JobScheduler } from '@iskra-bun/scheduler-kit';
import { WorkerManager } from '@iskra-bun/worker-kit';

const jobs: JobScheduler = process.env.REDIS_URL
    ? new WorkerManager({ connection: process.env.REDIS_URL })
    : new IntervalScheduler();

jobs.register('board-sync', syncBoard);
await jobs.schedule('board-sync', {}, { every: 180_000 });
```

What does not carry over: `runOnStart`, `timeoutMs`, `status()` and `healthCheck()` are scheduler-kit's; worker-kit's jobs have retries, `result()` and a dead-letter event instead.
