import { App } from '@iskra-bun/core';
import { DbDriver } from '@iskra-bun/db-kit';
import { WorkerManager } from '@iskra-bun/worker-kit';
import { config } from './app.config.ts';
import { WriterService } from './domain/writer/writer.service.ts';
import { AnswerValidatorService } from './domain/validation/answer-validator.service.ts';
import { handleAnswerJob } from './domain/answer-job.ts';
import { QUEUE_NAMES, JOB_NAMES, type AnswerJob } from '@forms-app/shared';
import { asFormsDb } from '@forms-app/shared/db/client';

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

worker.register<AnswerJob>(JOB_NAMES.ANSWER_SUBMIT, (job) => handleAnswerJob(job.data));

// Drivers stop in reverse order: the worker first (it waits for its active
// jobs, which wait for their answers to be flushed, so the flusher must still
// be running), then the flusher (final flush), then the database. The App
// handles SIGTERM/SIGINT; the handlers here used to flush before the worker
// stopped and run app.stop() a second time.
app.register(new DbDriver());
app.register({
    name: 'AnswerFlusher',
    init() {},
    async start() {
        const dbDriver = app.context.get('db');
        if (!dbDriver?.db) throw new Error('DB Driver not initialized');
        const db = asFormsDb(dbDriver.db);
        WriterService.setDb(db);
        AnswerValidatorService.setDb(db);
        WriterService.startFlushTimer();
        console.log('Answer Writer services initialized');
    },
    async stop() {
        await WriterService.shutdown();
    },
});
app.register(worker);

async function main() {
    await app.start();
    console.log(`Answer Writer running (consumers only, no HTTP)`);
    console.log(`Batch config: max=${config.batch.maxSize}, flush=${config.batch.flushIntervalMs}ms`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
