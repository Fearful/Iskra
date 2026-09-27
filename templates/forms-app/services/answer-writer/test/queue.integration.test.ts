import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { App } from '@iskra-bun/core';
import { WorkerManager } from '@iskra-bun/worker-kit';
import { Queue } from 'bullmq';
import { JOB_NAMES, type AnswerJob } from '@forms-app/shared';
import { AnswerValidatorService } from '../src/domain/validation/answer-validator.service.ts';
import { WriterService } from '../src/domain/writer/writer.service.ts';
import { handleAnswerJob } from '../src/domain/answer-job.ts';
import { SubmissionService } from '../../forms-api/src/domain/submission/submission.service.ts';
import { generateJsonSchema } from '../../admin-api/src/domain/forms/schema-generator.ts';
import type { FormsDb } from '@forms-app/shared/db/client';

// answer-writer's handler on a real BullMQ queue, with the retry options of
// src/main.ts, and the database faked: gated behind Redis only.
const REDIS_URL = process.env.TEST_REDIS_URL || 'redis://127.0.0.1:6379';

async function redisReachable(): Promise<boolean> {
    const url = new URL(REDIS_URL);
    return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 1000);
        Bun.connect({
            hostname: url.hostname,
            port: Number(url.port) || 6379,
            socket: {
                data() {},
                open(s) {
                    clearTimeout(timer);
                    s.end();
                    resolve(true);
                },
                connectError() {
                    clearTimeout(timer);
                    resolve(false);
                },
            },
        }).catch(() => {
            clearTimeout(timer);
            resolve(false);
        });
    });
}

const text = (name: string) => ({ fieldType: 'text', name, label: name, required: true });
const FORM = { status: 'open', endsAt: null, validationSchema: generateJsonSchema([text('name')] as any) };

/** A Drizzle-ish db with one open form (every select finds it); keeps the inserted answers. */
function fakeDb() {
    const db = {
        inserted: [] as AnswerJob[],
        select: () => ({ from: () => ({ where: async () => [FORM] }) }),
        insert: () => ({
            values: async (values: AnswerJob | AnswerJob[]) => void db.inserted.push(...[values].flat()),
        }),
    };
    return db;
}

((await redisReachable()) ? describe : describe.skip)('answer-writer on a BullMQ queue (requires Redis)', () => {
    const queueName = `answer-writer-queue-${Date.now()}`;
    const url = new URL(REDIS_URL);
    const queue = new Queue(queueName, {
        connection: {
            host: url.hostname,
            port: Number(url.port) || 6379,
            password: url.password ? decodeURIComponent(url.password) : undefined,
        },
    });
    const db = fakeDb();
    let wm: WorkerManager;

    beforeAll(async () => {
        (WriterService as any).buffer = [];
        WriterService.setDb(db as unknown as FormsDb);
        AnswerValidatorService.setDb(db as unknown as FormsDb);
        wm = new WorkerManager({
            connection: REDIS_URL,
            queueName,
            concurrency: 1,
            defaultJobOptions: { attempts: 3, backoff: { type: 'fixed', delay: 100 } },
        });
        wm.register<AnswerJob>(JOB_NAMES.ANSWER_SUBMIT, (job) => handleAnswerJob(job.data));
        await wm.init(new App({ name: 'AnswerWriterQueue', logger: { level: 'fatal' } }));
        await wm.start();
        WriterService.startFlushTimer();
    });

    afterAll(async () => {
        await WriterService.shutdown();
        await wm.stop();
        await queue.obliterate({ force: true });
        await queue.close();
    });

    const job = (data: Record<string, unknown>) => ({
        formId: 'form-1',
        data,
        ipHash: SubmissionService.hashIp('203.0.113.7', 'secret'),
        recaptchaScore: 90,
    });

    it('fails a forged answer on its first attempt, without storing it', async () => {
        // Anyone who can write to Redis can queue a job: answer-writer used
        // to store it as it came.
        const forged = await wm.enqueue(JOB_NAMES.ANSWER_SUBMIT, job({ name: 'x', role: 'admin' }));
        await expect(forged.result(10_000)).rejects.toThrow('Invalid answer for form form-1');

        const failed = await queue.getJob(forged.id);
        expect(await failed!.getState()).toBe('failed');
        expect(failed!.attemptsMade).toBe(1);
        expect(db.inserted).toHaveLength(0);
    });

    it('stores a valid answer', async () => {
        const valid = await wm.enqueue(JOB_NAMES.ANSWER_SUBMIT, job({ name: 'Ada' }));
        await valid.result(10_000);
        expect(db.inserted.map((a) => a.data)).toEqual([{ name: 'Ada' }]);
    });
});
