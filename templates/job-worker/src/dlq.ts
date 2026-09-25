import { WorkerManager } from '@iskra-bun/worker-kit';
import type { App } from '@iskra-bun/core';
import { config } from './app.config.ts';
import { increment } from './metrics.ts';

/**
 * Payload que se guarda en la dead-letter queue cuando un job agota sus
 * reintentos. Conserva el contexto original para poder reprocesar o auditar.
 */
export interface DeadLetter {
    readonly originalJob: string;
    readonly data: unknown;
    readonly attemptsMade: number;
    readonly error: string;
    readonly failedAt: string;
}

/**
 * Crea el `WorkerManager` que respalda la dead-letter queue.
 *
 * Es una queue normal de BullMQ con su propio nombre. No reintenta: los jobs
 * caen aca para inspeccion manual o reproceso. El handler `dead-letter` solo
 * registra el fallo; reemplazalo por persistencia (DB, alerta, etc.) segun tu caso.
 *
 * Redis conserva los ultimos `config.dlq.keep` dead letters: sin tope, la DLQ
 * crecia para siempre, con los payloads originales adentro.
 */
export function createDlq(app: App): WorkerManager {
    const dlq = new WorkerManager({
        connection: config.redis.url,
        concurrency: 1,
        queueName: config.dlq.queueName,
        defaultJobOptions: {
            attempts: 1,
            // Se conservan para inspeccion, pero acotados.
            removeOnComplete: config.dlq.keep,
            removeOnFail: config.dlq.keep,
        },
    });

    dlq.register('dead-letter', async (job) => {
        const dl = job.data as DeadLetter;
        // Sin `dl.data`: el payload queda en la DLQ, no en los logs.
        app.logger.error(
            {
                jobId: job.id,
                originalJob: dl.originalJob,
                attemptsMade: dl.attemptsMade,
                error: dl.error,
                failedAt: dl.failedAt,
            },
            'Job moved to dead-letter queue',
        );
    });

    return dlq;
}

/**
 * Mueve un job agotado a la dead-letter queue.
 *
 * Devuelve una copia inmutable del `DeadLetter` encolado.
 */
export async function moveToDlq(
    dlq: WorkerManager,
    params: { originalJob: string; data: unknown; attemptsMade: number; error: unknown },
): Promise<DeadLetter> {
    const deadLetter: DeadLetter = {
        originalJob: params.originalJob,
        data: params.data,
        attemptsMade: params.attemptsMade,
        error: params.error instanceof Error ? params.error.message : String(params.error),
        failedAt: new Date().toISOString(),
    };

    await dlq.enqueue('dead-letter', deadLetter);
    increment('deadLettered');

    return deadLetter;
}
