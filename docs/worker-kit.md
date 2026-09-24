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
| `connection` | `string \| object` | **requerido** | URL de Redis (`redis://user:pass@host:6379/0`; `rediss://` activa TLS) o `{ host, port, username, password, db, tls }` |
| `consume` | `boolean` | `true` | `false` = solo productor: no crea un Worker y `enqueue` acepta jobs sin handler local (los procesa otro proceso) |
| `concurrency` | `number` | `1` | Jobs procesados en paralelo |
| `queueName` | `string` | `'iskra-jobs'` | Nombre de la queue en Redis |
| `defaultJobOptions` | `JobOptions` | `undefined` | Opciones por defecto para todos los jobs |
| `deadLetter` | `boolean` | `false` | Activa el ruteo a dead-letter (ver [Manejo de Dead-Letter](#manejo-de-dead-letter)) |

### JobOptions

| Opcion | Tipo | Descripcion |
|--------|------|-------------|
| `attempts` | `number` | Reintentos en caso de fallo |
| `delay` | `number` | Delay en ms antes de procesar |
| `priority` | `number` | Prioridad (menor = mas prioritario) |
| `backoff` | `{ type, delay }` | Backoff entre reintentos (`fixed` o `exponential`) |
| `removeOnComplete` | `boolean \| number` | Eliminar job al completar (o mantener los ultimos N) |
| `removeOnFail` | `boolean \| number` | Eliminar job al fallar (o mantener los ultimos N) |
| `repeat` | `RepeatSpec` | Programa el job como repetible (cron o intervalo) |

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

## Validacion de Entrada

`enqueue` valida la entrada **antes** de tocar Redis, para evitar que entrada no confiable inunde la queue o almacene payloads gigantes. Cualquier problema lanza `QueueError` y el job nunca llega a la queue:

- **Handler desconocido:** el `name` debe corresponder a un handler ya registrado con `register` (salvo con `consume: false`). Si no, lanza `QueueError` (`No handler registered for job "<name>"`). Si igual llega a la queue un job que ningun worker sabe procesar, falla como irrecuperable (sin reintentos) y pasa por el dead-letter, en vez de marcarse como completado y perderse.
- **Payload sobredimensionado:** `data` se serializa a JSON y se rechaza si supera el tope de ~1 MB (`Job "<name>" payload too large: <bytes> bytes (max 1048576)`). Un `data` no serializable tambien lanza `QueueError`.
- **RepeatSpec invalida:** una spec de repeticion vacia, un `{ every }` no positivo o un cron en blanco lanzan `QueueError`.

```typescript
import { QueueError } from '@iskra-bun/worker-kit';

try {
    await worker.enqueue('handler.no.registrado', { ok: true });
} catch (err) {
    if (err instanceof QueueError) {
        // "No handler registered for job "handler.no.registrado""
    }
}
```

`schedule` delega en `enqueue`, asi que hereda exactamente las mismas validaciones.

## Payloads Tipados

`register` y `enqueue` aceptan parametros de tipo para que `job.data` y el valor de retorno sean completamente tipados. Por defecto son `unknown`/`void`, por lo que el codigo existente sin tipos sigue funcionando sin cambios.

```typescript
interface EmailPayload {
    to: string;
    subject: string;
}

interface EmailResult {
    messageId: string;
}

// Handler tipado — job.data es EmailPayload, tipo de retorno es EmailResult
worker.register<EmailPayload, EmailResult>('email.send', async (job) => {
    const { to, subject } = job.data; // tipado
    const id = await enviarEmail(to, subject);
    return { messageId: id };         // retorno tipado
});

// Encolar — descriptor.data y descriptor.result() estan tipados
const descriptor = await worker.enqueue<EmailPayload, EmailResult>(
    'email.send',
    { to: 'user@example.com', subject: 'Hola' },
);
```

El tipo `JobHandler<T, R>` tambien puede importarse directamente para declaraciones de handlers:

```typescript
import type { JobHandler } from '@iskra-bun/worker-kit';

const handler: JobHandler<EmailPayload, EmailResult> = async (job) => {
    return { messageId: await enviarEmail(job.data.to, job.data.subject) };
};
worker.register('email.send', handler);
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

## Jobs Programados / Repetibles

Usa el metodo de conveniencia `schedule` o agrega el campo `repeat` en `JobOptions` para ejecutar un job de forma recurrente.

`RepeatSpec` acepta:

- Un string cron: `'0 9 * * 1-5'`
- Un objeto de intervalo: `{ every: ms, limit?: n }`
- Un objeto cron con zona horaria: `{ pattern: '0 9 * * *', tz: 'America/New_York', limit?: n }`

```typescript
// String cron — todos los dias de semana a las 09:00
await worker.schedule('reporte.diario', { tipo: 'diario' }, '0 9 * * 1-5');

// Cada 30 minutos, maximo 10 veces
await worker.schedule('cache.warm', {}, { every: 30 * 60 * 1000, limit: 10 });

// Cron con zona horaria
await worker.schedule(
    'facturacion.mensual',
    { plan: 'pro' },
    { pattern: '0 0 1 * *', tz: 'UTC' },
);

// Equivalente via enqueue + opcion repeat
await worker.enqueue('reporte.diario', { tipo: 'diario' }, {
    repeat: '0 9 * * 1-5',
    attempts: 2,
});
```

Firma de `schedule`:

```typescript
schedule<T, R>(
    name: string,
    data: T,
    repeat: RepeatSpec,
    opts?: JobOptions,       // el resto de JobOptions sigue aplicando
): Promise<JobDescriptor<T, R>>
```

## Resultados de Jobs

Tanto `enqueue` como `schedule` devuelven un `JobDescriptor`. El helper `result()` espera a que el job termine y resuelve con el valor de retorno del handler (respaldado por `QueueEvents` de BullMQ).

```typescript
const descriptor = await worker.enqueue<EmailPayload, EmailResult>(
    'email.send',
    { to: 'user@example.com', subject: 'Hola' },
);

// Esperar hasta 10 segundos a que el handler termine
const { messageId } = await descriptor.result(10_000);
```

Forma de `JobDescriptor`:

```typescript
interface JobDescriptor<T, R> {
    id: string;
    name: string;
    data: T;
    result(ttlMs?: number): Promise<R>; // ttlMs: timeout opcional en milisegundos
}
```

`result()` abre una conexion `QueueEvents` compartida de forma perezosa en la primera llamada. Si el job falla, `result()` rechaza con el error de fallo.

### result() antes de stop()

`result()` requiere una conexion `QueueEvents` viva, que el manager abre de forma perezosa. Una vez que llamas a `stop()`, esa conexion (y la queue) se cierran, y cualquier llamada posterior a `result()` **rechaza con `QueueError`** (`WorkerManager is stopped; cannot open QueueEvents`) en lugar de abrir una conexion huerfana que nunca se cerraria.

Por eso, **espera el resultado del job antes de llamar a `stop()`**:

```typescript
const descriptor = await worker.enqueue('email.send', { to: 'user@example.com' });
const result = await descriptor.result(10_000); // OK: antes de stop()

await worker.stop();

await descriptor.result(); // rechaza con QueueError: el manager esta detenido
```

## Manejo de Dead-Letter

Activa con `deadLetter: true` en `WorkerManagerOptions`. Una vez activado, cuando un job agota todos sus reintentos el manager emite el evento `worker:dead-letter` en el bus de eventos de la App en lugar de descartar el job silenciosamente.

```typescript
const worker = new WorkerManager({
    connection: process.env.REDIS_URL || 'redis://localhost:6379',
    deadLetter: true,
    defaultJobOptions: { attempts: 3 },
});

// Escuchar en el bus de eventos de la App
app.events.on('worker:dead-letter', (payload) => {
    console.error('Job en dead-letter:', payload);
    // payload.jobId, payload.name, payload.data, payload.failedReason, payload.attemptsMade
});
```

Forma de `DeadLetterPayload`:

```typescript
interface DeadLetterPayload {
    jobId: string | undefined;
    name: string | undefined;
    data: unknown;
    failedReason: string | undefined;
    attemptsMade: number;
}
```

`deadLetter` tiene por defecto `false`, por lo que el codigo existente no se ve afectado.

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
