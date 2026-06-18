import { App } from '@iskra-bun/core';
import { DbDriver } from '@iskra-bun/db-kit';
import { WorkerManager } from '@iskra-bun/worker-kit';
import { config } from './app.config.ts';
import { WriterService } from './domain/writer/writer.service.ts';
import { QUEUE_NAMES, JOB_NAMES } from '@forms-app/shared';

const app = new App({ name: 'AnswerWriter' });

app.config.db = config.db;

const worker = new WorkerManager({
    connection: config.redis.url,
    concurrency: config.worker.concurrency,
    queueName: QUEUE_NAMES.ANSWERS,
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 100,
        removeOnFail: 500,
    },
});

worker.register(JOB_NAMES.ANSWER_SUBMIT, async (job) => {
    await WriterService.bufferAnswer(job.data);
});

app.register(new DbDriver());
app.register(worker);

async function setup() {
    const dbDriver = app.context.get('db');
    if (!dbDriver?.db) {
        console.error('DB Driver not initialized');
        return;
    }

    WriterService.setDb(dbDriver.db);
    WriterService.startFlushTimer();

    console.log('Answer Writer services initialized');
}

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM received, shutting down gracefully');
    await WriterService.shutdown();
    await app.stop();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('SIGINT received, shutting down gracefully');
    await WriterService.shutdown();
    await app.stop();
    process.exit(0);
});

async function main() {
    await app.start();
    await setup();
    console.log(`Answer Writer running (consumers only, no HTTP)`);
    console.log(`Batch config: max=${config.batch.maxSize}, flush=${config.batch.flushIntervalMs}ms`);
}

main().catch(console.error);
