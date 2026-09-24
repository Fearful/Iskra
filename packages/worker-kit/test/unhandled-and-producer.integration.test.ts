import { describe, it, expect, afterEach } from 'bun:test';
import { Queue } from 'bullmq';
import { App } from '@iskra-bun/core';
import { WorkerManager } from '../src/index';

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
                open(socket) { clearTimeout(timer); socket.end(); resolve(true); },
                connectError() { clearTimeout(timer); resolve(false); },
            },
        }).catch(() => { clearTimeout(timer); resolve(false); });
    });
}

const redisUp = await redisReachable();
const url = new URL(REDIS_URL);
const connection = { host: url.hostname, port: Number(url.port) || 6379 };

describe.if(redisUp)('WorkerManager job routing (requires Redis)', () => {
    const managers: { app: App }[] = [];
    afterEach(async () => {
        while (managers.length) await managers.pop()!.app.stop();
    });

    async function startManager(queueName: string, opts: { consume?: boolean; deadLetter?: boolean } = {}) {
        const app = new App({ name: 'WorkerRouting', logger: { level: 'silent' } });
        const wm = new WorkerManager({ connection: REDIS_URL, queueName, ...opts });
        app.register(wm);
        managers.push({ app });
        return { app, wm };
    }

    it('a producer-only instance enqueues jobs handled by another process', async () => {
        const queueName = `iskra-producer-${Date.now()}`;
        // Consumer with the handler...
        const consumer = await startManager(queueName);
        consumer.wm.register<{ n: number }, number>('double', async (job) => job.data.n * 2);
        await consumer.app.start();
        // ...and an API-style producer without handlers (used to throw "No handler registered").
        const producer = await startManager(queueName, { consume: false });
        await producer.app.start();

        const job = await producer.wm.enqueue<{ n: number }, number>('double', { n: 21 });
        expect(await job.result(5000)).toBe(42);
    });

    it('fails (does not complete) a job nobody handles, and dead-letters it', async () => {
        // Regression: the worker returned early, so BullMQ marked the job
        // "completed" and it disappeared.
        const queueName = `iskra-unhandled-${Date.now()}`;
        const consumer = await startManager(queueName, { deadLetter: true });
        const deadLetters: any[] = [];
        consumer.app.on('worker:dead-letter', (ctx) => { deadLetters.push(ctx.payload); });
        await consumer.app.start();
        const producer = await startManager(queueName, { consume: false });
        await producer.app.start();

        const job = await producer.wm.enqueue('ghost-job', { x: 1 }, { attempts: 3 });
        await expect(job.result(5000)).rejects.toThrow(/No handler registered/);

        const queue = new Queue(queueName, { connection });
        try {
            const stored = await queue.getJob(job.id);
            expect(await stored!.getState()).toBe('failed');
            expect(stored!.attemptsMade).toBe(1); // unrecoverable: no pointless retries
        } finally {
            await queue.obliterate({ force: true });
            await queue.close();
        }
        await Bun.sleep(50);
        expect(deadLetters.map((d) => d.name)).toEqual(['ghost-job']);
    });
});
