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
| `connection` | `string \| object` | **required** | Redis URL or `{ host, port, password, db }` |
| `concurrency` | `number` | `1` | Jobs processed in parallel |
| `queueName` | `string` | `'iskra-jobs'` | Name of the queue in Redis |
| `defaultJobOptions` | `JobOptions` | `undefined` | Default options for all jobs |

### JobOptions

| Option | Type | Description |
|--------|------|-------------|
| `attempts` | `number` | Retries on failure |
| `delay` | `number` | Delay in ms before processing |
| `priority` | `number` | Priority (lower = higher priority) |
| `backoff` | `{ type, delay }` | Backoff between retries (`fixed` or `exponential`) |
| `removeOnComplete` | `boolean \| number` | Remove job on completion (or keep the last N) |
| `removeOnFail` | `boolean \| number` | Remove job on failure (or keep the last N) |

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
