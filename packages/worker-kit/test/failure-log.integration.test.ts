import { describe, it, expect, beforeAll, afterAll, spyOn } from 'bun:test';
import { WorkerManager } from '../src/index';
import { App } from '@iskra-bun/core';

// A failing job is logged once at error level (by the `failed` handler), not
// once by the processor and again by `failed`. Needs Redis (TEST_REDIS_URL).
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

describe.if(redisUp)('WorkerManager failure logging (requires Redis)', () => {
    let app: App;
    let wm: WorkerManager;
    const queueName = `iskra-test-faillog-${Date.now()}`;

    beforeAll(async () => {
        app = new App({ name: 'WorkerFailLogIT', logger: { level: 'error' } });
        wm = new WorkerManager({ connection: REDIS_URL, queueName, concurrency: 1 });
        wm.register('explode', async () => {
            throw new Error('kaput');
        });
        await wm.init(app);
        await wm.start();
    });

    afterAll(async () => {
        await wm.stop();
    });

    it('logs a failed job once at error level, with its id and attempts', async () => {
        const errors: unknown[][] = [];
        const spy = spyOn(app.logger, 'error').mockImplementation((...args: unknown[]) => {
            errors.push(args);
        });
        try {
            const { id } = await wm.enqueue('explode', {});
            const deadline = Date.now() + 5000;
            while (!errors.length && Date.now() < deadline) await Bun.sleep(25);
            // Leave time for a second (duplicate) log to show up.
            await Bun.sleep(200);

            expect(errors).toHaveLength(1);
            const [fields, msg] = errors[0] as [Record<string, unknown>, string];
            expect(msg).toBe('Job failed');
            expect(fields.jobId).toBe(id);
            expect(fields.jobName).toBe('explode');
            expect(fields.attemptsMade).toBe(1);
        } finally {
            spy.mockRestore();
        }
    });
});
