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

    async function producer() {
        const queueName = `iskra-defaults-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const app = new App({ name: 'Defaults', logger: { level: 'silent' } });
        const wm = new WorkerManager({ connection: REDIS_URL, queueName, consume: false, defaultJobOptions: DEFAULTS });
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
});
