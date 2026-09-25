import { describe, it, expect, afterEach } from 'bun:test';
import { Queue } from 'bullmq';
import { App } from '@iskra-bun/core';
import { WorkerManager, type JobOptions } from '../src/index';

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
                open(socket) {
                    clearTimeout(timer);
                    socket.end();
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

const redisUp = await redisReachable();
const url = new URL(REDIS_URL);
const connection = { host: url.hostname, port: Number(url.port) || 6379 };

const DEFAULTS = { attempts: 3, backoff: { type: 'exponential' as const, delay: 1000 }, removeOnComplete: 100 };

describe.if(redisUp)('defaultJobOptions (requires Redis)', () => {
    const apps: App[] = [];
    const queues: Queue[] = [];
    afterEach(async () => {
        while (apps.length) await apps.pop()!.stop();
        while (queues.length) {
            const q = queues.pop()!;
            await q.obliterate({ force: true });
            await q.close();
        }
    });

    async function producer(defaultJobOptions: JobOptions = DEFAULTS) {
        const queueName = `iskra-defaults-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const app = new App({ name: 'Defaults', logger: { level: 'silent' } });
        const wm = new WorkerManager({ connection: REDIS_URL, queueName, consume: false, defaultJobOptions });
        app.register(wm);
        await app.start();
        apps.push(app);
        const queue = new Queue(queueName, { connection });
        queues.push(queue);
        return { wm, queue };
    }

    it('keeps the defaults when a job sets other options', async () => {
        // Regression: { priority } alone came out as attempts 0, no backoff.
        const { wm, queue } = await producer();
        const job = await wm.enqueue('task', { n: 1 }, { priority: 5 });
        const stored = (await queue.getJob(job.id))!;
        expect(stored.opts).toMatchObject({ ...DEFAULTS, priority: 5 });
    });

    it('keeps the defaults on scheduled jobs', async () => {
        const { wm, queue } = await producer();
        await wm.schedule('nightly', {}, '0 3 * * *');
        const [job] = await queue.getDelayed();
        expect(job.opts).toMatchObject(DEFAULTS);
    });

    it('keeps a bounded number of finished jobs unless told otherwise', async () => {
        // BullMQ keeps every completed and failed job, payload included, forever.
        const { wm, queue } = await producer({});
        const job = await wm.enqueue('task', { email: 'user@example.com' });
        const stored = (await queue.getJob(job.id))!;
        expect(stored.opts.removeOnComplete).toEqual({ count: 1000 });
        expect(stored.opts.removeOnFail).toEqual({ age: 7 * 24 * 60 * 60, count: 5000 });
    });

    it('lets defaultJobOptions and each job set their own retention', async () => {
        const { wm, queue } = await producer({ removeOnComplete: false });
        const kept = (await queue.getJob((await wm.enqueue('task', {})).id))!;
        expect(kept.opts.removeOnComplete).toBe(false);
        expect(kept.opts.removeOnFail).toEqual({ age: 7 * 24 * 60 * 60, count: 5000 });

        const own = (await queue.getJob((await wm.enqueue('task', {}, { removeOnFail: { count: 10 } })).id))!;
        expect(own.opts.removeOnFail).toEqual({ count: 10 });
    });

    it('trims the completed jobs to the count kept', async () => {
        const queueName = `iskra-retention-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const app = new App({ name: 'Retention', logger: { level: 'silent' } });
        const wm = new WorkerManager({
            connection: REDIS_URL,
            queueName,
            defaultJobOptions: { removeOnComplete: { count: 2 } },
        });
        let processed = 0;
        wm.register('task', async () => {
            processed++;
        });
        app.register(wm);
        await app.start();
        apps.push(app);
        const queue = new Queue(queueName, { connection });
        queues.push(queue);

        for (const n of [1, 2, 3, 4, 5]) await wm.enqueue('task', { n });
        const deadline = Date.now() + 5000;
        while ((processed < 5 || (await queue.getActiveCount()) > 0) && Date.now() < deadline) await Bun.sleep(20);
        expect(processed).toBe(5);
        expect(await queue.getCompletedCount()).toBe(2);
    });
});
