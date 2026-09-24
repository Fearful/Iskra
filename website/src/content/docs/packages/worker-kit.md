---
title: Worker Kit
description: Background job queue using BullMQ with Redis.
---

Background job queue using BullMQ with Redis.

## Quick Start

```typescript
import { App } from '@iskra-bun/core';
import { WorkerManager } from '@iskra-bun/worker-kit';

const app = new App({ name: 'MiWorker' });

const worker = new WorkerManager({
    connection: process.env.REDIS_URL || 'redis://localhost:6379',
    concurrency: 3,
    queueName: 'mi-app-jobs',
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 100,
    },
});

// Registrar handlers
worker.register('email.send', async (job) => {
    console.log(`Enviando email a ${job.data.to}...`);
    await enviarEmail(job.data);
});

worker.register('image.resize', async (job) => {
    console.log(`Procesando imagen: ${job.data.url}`);
    await procesarImagen(job.data);
});

app.register(worker);
await app.start();

// Encolar jobs
await worker.enqueue('email.send', { to: 'user@example.com', subject: 'Hola' });
await worker.enqueue('image.resize', { url: '/uploads/foto.jpg', width: 800 });
```

## Configuration

### WorkerManagerOptions

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `connection` | `string \| object` | **required** | Redis URL (`redis://user:pass@host:6379/0`; `rediss://` enables TLS) or `{ host, port, username, password, db, tls }` |
| `consume` | `boolean` | `true` | `false` = producer only: no Worker is created and `enqueue` accepts jobs without a local handler (another process runs them) |
| `concurrency` | `number` | `1` | Jobs processed in parallel; `0` = producer-only, like `consume: false` |
| `queueName` | `string` | `'iskra-jobs'` | Name of the queue in Redis |
| `defaultJobOptions` | `JobOptions` | `undefined` | Default options for all jobs |
| `deadLetter` | `boolean` | `false` | Enable dead-letter routing (see [Dead-Letter Handling](#dead-letter-handling)) |

### JobOptions

| Option | Type | Description |
|--------|------|-------------|
| `attempts` | `number` | Retries on failure |
| `delay` | `number` | Delay in ms before processing |
| `priority` | `number` | Priority (lower = higher priority) |
| `backoff` | `{ type, delay }` | Backoff between retries (`fixed` or `exponential`) |
| `removeOnComplete` | `boolean \| number` | Remove job on completion (or keep the last N) |
| `removeOnFail` | `boolean \| number` | Remove job on failure (or keep the last N) |
| `repeat` | `RepeatSpec` | Schedule the job as repeating (cron or interval) |

## Enqueue with Options

```typescript
// Job con delay de 5 minutos
await worker.enqueue('reminder.send', { userId: 123 }, {
    delay: 5 * 60 * 1000,
});

// Job con alta prioridad y 5 reintentos
await worker.enqueue('payment.process', { orderId: 456 }, {
    priority: 1,
    attempts: 5,
    backoff: { type: 'exponential', delay: 2000 },
});
```

## Input Validation

`enqueue` validates input **before** touching Redis, so untrusted input cannot flood the queue or store oversized payloads. Any problem throws `QueueError` and the job never reaches the queue:

- **Unknown handler:** `name` must match a handler already registered with `register` (except with `consume: false`). Otherwise it throws `QueueError` (`No handler registered for job "<name>"`). If a job no worker can process reaches the queue anyway, it fails as unrecoverable (no retries) and goes through dead-letter handling, instead of being marked completed and lost.
- **Oversized payload:** `data` is serialized to JSON and rejected if it exceeds the ~1 MB cap (`Job "<name>" payload too large: <bytes> bytes (max 1048576)`). A non-serializable `data` also throws `QueueError`.
- **Invalid RepeatSpec:** an empty repeat spec, a non-positive `{ every }`, or a blank cron string throw `QueueError`.

```typescript
import { QueueError } from '@iskra-bun/worker-kit';

try {
    await worker.enqueue('unregistered.handler', { ok: true });
} catch (err) {
    if (err instanceof QueueError) {
        // "No handler registered for job "unregistered.handler""
    }
}
```

`schedule` delegates to `enqueue`, so it inherits exactly the same validations.

## Typed Payloads

`register` and `enqueue` accept type parameters so `job.data` and the return value are fully typed. Both default to `unknown`/`void`, so existing untyped code continues to work without changes.

```typescript
interface EmailPayload {
    to: string;
    subject: string;
}

interface EmailResult {
    messageId: string;
}

// Register a typed handler — job.data is EmailPayload, return type is EmailResult
worker.register<EmailPayload, EmailResult>('email.send', async (job) => {
    const { to, subject } = job.data; // typed
    const id = await sendEmail(to, subject);
    return { messageId: id };         // typed return value
});

// Enqueue — descriptor.data and descriptor.result() are typed
const descriptor = await worker.enqueue<EmailPayload, EmailResult>(
    'email.send',
    { to: 'user@example.com', subject: 'Hello' },
);
```

The `JobHandler<T, R>` type can also be imported directly for standalone handler declarations:

```typescript
import type { JobHandler } from '@iskra-bun/worker-kit';

const handler: JobHandler<EmailPayload, EmailResult> = async (job) => {
    return { messageId: await sendEmail(job.data.to, job.data.subject) };
};
worker.register('email.send', handler);
```

## Handler

Each handler receives an object with:

```typescript
worker.register('mi.job', async (job) => {
    job.id;            // ID unico del job
    job.name;          // Nombre del job ('mi.job')
    job.data;          // Datos que le pasaste al encolar
    job.attemptsMade;  // Numero de intento actual
});
```

If the handler throws an exception, BullMQ automatically retries it according to the `attempts` and `backoff` config.

## Scheduled / Repeat Jobs

Use the `schedule` convenience method or add a `repeat` field to `JobOptions` to run a job on a recurring schedule.

`RepeatSpec` accepts:

- A cron string: `'0 9 * * 1-5'`
- An interval object: `{ every: ms, limit?: n }`
- A cron object with timezone: `{ pattern: '0 9 * * *', tz: 'America/New_York', limit?: n }`

```typescript
// Cron string — every weekday at 09:00
await worker.schedule('report.daily', { type: 'daily' }, '0 9 * * 1-5');

// Every 30 minutes, at most 10 times
await worker.schedule('cache.warm', {}, { every: 30 * 60 * 1000, limit: 10 });

// Cron with timezone
await worker.schedule(
    'billing.monthly',
    { plan: 'pro' },
    { pattern: '0 0 1 * *', tz: 'UTC' },
);

// Equivalent via enqueue + repeat option
await worker.enqueue('report.daily', { type: 'daily' }, {
    repeat: '0 9 * * 1-5',
    attempts: 2,
});
```

`schedule` signature:

```typescript
schedule<T, R>(
    name: string,
    data: T,
    repeat: RepeatSpec,
    opts?: JobOptions,       // all other JobOptions still apply
): Promise<JobDescriptor<T, R>>
```

## Job Results

Both `enqueue` and `schedule` return a `JobDescriptor`. The `result()` helper waits for the job to finish and resolves with the handler's return value (backed by BullMQ `QueueEvents`).

```typescript
const descriptor = await worker.enqueue<EmailPayload, EmailResult>(
    'email.send',
    { to: 'user@example.com', subject: 'Hello' },
);

// Wait up to 10 seconds for the handler to finish
const { messageId } = await descriptor.result(10_000);
```

`JobDescriptor` shape:

```typescript
interface JobDescriptor<T, R> {
    id: string;
    name: string;
    data: T;
    result(ttlMs?: number): Promise<R>; // ttlMs: optional timeout in milliseconds
}
```

`result()` opens a shared `QueueEvents` connection lazily on first call. If the job fails, `result()` rejects with the failure error.

### result() before stop()

`result()` requires a live `QueueEvents` connection, which the manager opens lazily. Once you call `stop()`, that connection (and the queue) are closed, and any subsequent `result()` call **rejects with `QueueError`** (`WorkerManager is stopped; cannot open QueueEvents`) instead of opening an orphan connection that would never be closed.

So **await the job result before calling `stop()`**:

```typescript
const descriptor = await worker.enqueue('email.send', { to: 'user@example.com' });
const result = await descriptor.result(10_000); // OK: before stop()

await worker.stop();

await descriptor.result(); // rejects with QueueError: the manager is stopped
```

## Dead-Letter Handling

Opt in by setting `deadLetter: true` on `WorkerManagerOptions`. Once enabled, when a job exhausts all its retries the manager emits a `worker:dead-letter` event on the App event bus instead of silently dropping the job.

```typescript
const worker = new WorkerManager({
    connection: process.env.REDIS_URL || 'redis://localhost:6379',
    deadLetter: true,
    defaultJobOptions: { attempts: 3 },
});

// Listen on the App event bus
app.events.on('worker:dead-letter', (payload) => {
    console.error('Dead-letter job:', payload);
    // payload.jobId, payload.name, payload.data, payload.failedReason, payload.attemptsMade
});
```

`DeadLetterPayload` shape:

```typescript
interface DeadLetterPayload {
    jobId: string | undefined;
    name: string | undefined;
    data: unknown;
    failedReason: string | undefined;
    attemptsMade: number;
}
```

`deadLetter` defaults to `false`, so existing code is unaffected.

## Errors

```typescript
import { QueueError, JobError } from '@iskra-bun/worker-kit';

// QueueError: problemas con la conexion o inicializacion de la queue
// JobError: fallo al ejecutar un job
```

## Requirements

- **Redis** running (local or remote)

```bash
# Levantar Redis con Docker
docker run -d --name redis -p 6379:6379 redis:7-alpine
```

## Environment Variables

```bash
REDIS_URL=redis://localhost:6379
```
