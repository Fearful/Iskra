# @iskra-bun/worker-kit

Cola de jobs en background usando BullMQ con Redis.

## Inicio Rapido

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

## Configuracion

### WorkerManagerOptions

| Opcion | Tipo | Default | Descripcion |
|--------|------|---------|-------------|
| `connection` | `string \| object` | **requerido** | URL de Redis o `{ host, port, password, db }` |
| `concurrency` | `number` | `1` | Jobs procesados en paralelo |
| `queueName` | `string` | `'iskra-jobs'` | Nombre de la queue en Redis |
| `defaultJobOptions` | `JobOptions` | `undefined` | Opciones por defecto para todos los jobs |

### JobOptions

| Opcion | Tipo | Descripcion |
|--------|------|-------------|
| `attempts` | `number` | Reintentos en caso de fallo |
| `delay` | `number` | Delay en ms antes de procesar |
| `priority` | `number` | Prioridad (menor = mas prioritario) |
| `backoff` | `{ type, delay }` | Backoff entre reintentos (`fixed` o `exponential`) |
| `removeOnComplete` | `boolean \| number` | Eliminar job al completar (o mantener los ultimos N) |
| `removeOnFail` | `boolean \| number` | Eliminar job al fallar (o mantener los ultimos N) |

## Encolar con Opciones

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

Cada handler recibe un objeto con:

```typescript
worker.register('mi.job', async (job) => {
    job.id;            // ID unico del job
    job.name;          // Nombre del job ('mi.job')
    job.data;          // Datos que le pasaste al encolar
    job.attemptsMade;  // Numero de intento actual
});
```

Si el handler tira una excepcion, BullMQ lo reintenta automaticamente segun la config de `attempts` y `backoff`.

## Errores

```typescript
import { QueueError, JobError } from '@iskra-bun/worker-kit';

// QueueError: problemas con la conexion o inicializacion de la queue
// JobError: fallo al ejecutar un job
```

## Requisitos

- **Redis** corriendo (local o remoto)

```bash
# Levantar Redis con Docker
docker run -d --name redis -p 6379:6379 redis:7-alpine
```

## Variables de Entorno

```bash
REDIS_URL=redis://localhost:6379
```
