import type { App } from '@iskra-bun/core';
import type { WorkerManager, JobHandler } from '@iskra-bun/worker-kit';
import { config } from './app.config.ts';
import { moveToDlq } from './dlq.ts';
import { increment } from './metrics.ts';

/**
 * Envuelve un handler de negocio con:
 *  - conteo de metricas (completed / failed / retried)
 *  - deteccion de "reintentos agotados" → dead-letter queue
 *
 * El backoff entre reintentos lo maneja BullMQ via `defaultJobOptions` (ver main.ts).
 * Cuando el ultimo intento falla, el job se mueve a la DLQ en lugar de perderse.
 */
function withRetryAndDlq(app: App, dlq: WorkerManager, name: string, handler: JobHandler): JobHandler {
    return async (job) => {
        if (job.attemptsMade > 0) {
            increment('retried');
            app.logger.warn({ jobId: job.id, jobName: name, attempt: job.attemptsMade + 1 }, 'Retrying job');
        }

        try {
            await handler(job);
            increment('completed');
            app.logger.info({ jobId: job.id, jobName: name }, 'Job completed');
        } catch (err) {
            increment('failed');

            // `attemptsMade` es 0-indexed: en el ultimo intento permitido vale attempts-1.
            const isLastAttempt = job.attemptsMade + 1 >= config.retry.attempts;

            if (isLastAttempt) {
                await moveToDlq(dlq, {
                    originalJob: name,
                    data: job.data,
                    attemptsMade: job.attemptsMade + 1,
                    error: err,
                });
                // No re-lanzamos: el job se considera "manejado" via DLQ.
                return;
            }

            // Re-lanzamos para que BullMQ aplique el backoff y reintente.
            throw err;
        }
    };
}

/**
 * Registra los handlers de ejemplo en el worker principal.
 * Reemplaza estos por tu logica real.
 */
export function registerJobs(app: App, worker: WorkerManager, dlq: WorkerManager): void {
    worker.register(
        'email.send',
        withRetryAndDlq(app, dlq, 'email.send', async (job) => {
            app.logger.info({ data: job.data }, 'Sending email');
            await new Promise((resolve) => setTimeout(resolve, 300));
        }),
    );

    worker.register(
        'image.process',
        withRetryAndDlq(app, dlq, 'image.process', async (job) => {
            app.logger.info({ data: job.data }, 'Processing image');
            await new Promise((resolve) => setTimeout(resolve, 600));
        }),
    );

    // Job que falla a proposito para demostrar retry/backoff + dead-letter.
    worker.register(
        'flaky.task',
        withRetryAndDlq(app, dlq, 'flaky.task', async (job) => {
            app.logger.info({ data: job.data }, 'Running flaky task');
            throw new Error('flaky.task siempre falla (demo de DLQ)');
        }),
    );
}
