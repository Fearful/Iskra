import { App } from '@iskra-bun/core';
import { WorkerManager } from '@iskra-bun/worker-kit';
import { WebPlugin } from '@iskra-bun/web-kit';
import { config } from './app.config.ts';
import { createDlq } from './dlq.ts';
import { registerJobs } from './jobs.ts';
import { increment } from './metrics.ts';
import { createMonitoringRouter } from './http/monitoring.ts';

const app = new App({ name: 'JobWorker' });

// ─── Worker principal ────────────────────────────────────────────────────────
// El retry/backoff lo aplica BullMQ via defaultJobOptions. Cuando se agotan
// los intentos, jobs.ts mueve el job a la dead-letter queue.
const worker = new WorkerManager({
    connection: config.redis.url,
    concurrency: config.worker.concurrency,
    queueName: config.worker.queueName,
    defaultJobOptions: {
        attempts: config.retry.attempts,
        backoff: {
            type: config.retry.backoffType,
            delay: config.retry.backoffDelay,
        },
        removeOnComplete: 100,
        removeOnFail: 500,
    },
});

// ─── Dead-letter queue ───────────────────────────────────────────────────────
const dlq = createDlq(app);

// ─── Handlers ────────────────────────────────────────────────────────────────
registerJobs(app, worker, dlq);

// ─── Drivers ─────────────────────────────────────────────────────────────────
app.register(worker);
app.register(dlq);
app.register(
    new WebPlugin({
        port: config.http.port,
        router: createMonitoringRouter(),
    }),
);

async function main() {
    await app.start();
    app.logger.info(
        { queue: config.worker.queueName, dlq: config.dlq.queueName, httpPort: config.http.port },
        'Worker is running',
    );

    if (config.demo) {
        // Encola jobs de demostracion. DEMO=false para desactivar.
        setInterval(() => {
            worker.enqueue('email.send', { to: 'user@example.com', subject: 'Hola' });
            increment('enqueued');
        }, 5000);

        setInterval(() => {
            worker.enqueue('image.process', { url: 'https://example.com/image.png' });
            increment('enqueued');
        }, 7000);

        // Job que falla siempre → demuestra retry/backoff y la DLQ.
        setInterval(() => {
            worker.enqueue('flaky.task', { reason: 'demo' });
            increment('enqueued');
        }, 15000);
    }
}

main().catch((err) => {
    app.logger.error({ err }, 'Fatal error starting worker');
    process.exit(1);
});
