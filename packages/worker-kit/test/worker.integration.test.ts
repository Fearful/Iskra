import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { WorkerManager } from '../src/index';
import { App } from '@iskra-bun/core';

// Real BullMQ lifecycle against a running Redis. The block is skipped when no
// Redis is reachable, so the unit suite stays infra-free. Point at a custom
// instance with TEST_REDIS_URL.
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

describe.if(redisUp)('WorkerManager integration (requires Redis)', () => {
    let app: App;
    let wm: WorkerManager;
    const queueName = `iskra-test-${Date.now()}`;

    // Jobs are processed asynchronously and possibly out of order, so collect
    // every processed job and let each test await the one it cares about by tag.
    const processed: any[] = [];
    const waiters = new Set<(job: any) => void>();

    function record(job: any) {
        processed.push(job);
        for (const w of waiters) w(job);
    }

    function waitForTag(tag: string, timeoutMs = 5000): Promise<any> {
        const match = (job: any) => job?.data?.tag === tag;
        const existing = processed.find(match);
        if (existing) return Promise.resolve(existing);

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                waiters.delete(waiter);
                reject(new Error(`Timed out waiting for job tagged "${tag}"`));
            }, timeoutMs);
            const waiter = (job: any) => {
                if (match(job)) {
                    clearTimeout(timer);
                    waiters.delete(waiter);
                    resolve(job);
                }
            };
            waiters.add(waiter);
        });
    }

    beforeAll(async () => {
        app = new App({ name: 'WorkerIT', logger: { level: 'error' } });
        wm = new WorkerManager({ connection: REDIS_URL, queueName, concurrency: 1 });

        wm.register('greet', async (job) => record(job));
        wm.register('with.opts', async (job) => record(job));

        await wm.init(app);
        await wm.start();
    });

    afterAll(async () => {
        await wm.stop();
    });

    it('enqueues a job and returns its descriptor', async () => {
        const result = await wm.enqueue('greet', { name: 'Ada', tag: 'descriptor' });
        expect(result.name).toBe('greet');
        expect(result.data).toEqual({ name: 'Ada', tag: 'descriptor' });
        expect(result.id).toBeDefined();
    });

    it('processes an enqueued job through its registered handler', async () => {
        await wm.enqueue('greet', { name: 'Grace', tag: 'process' });

        const job = await waitForTag('process');
        expect(job.name).toBe('greet');
        expect(job.data).toEqual({ name: 'Grace', tag: 'process' });
        expect(job.id).toBeDefined();
    });

    it('honors per-job options when enqueuing', async () => {
        await wm.enqueue('with.opts', { tag: 'opts' }, { attempts: 2, priority: 1 });

        const job = await waitForTag('opts');
        expect(job.data).toEqual({ tag: 'opts' });
    });
});

// ─── Increment D: repeat / result / dead-letter against real Redis ───────────

describe.if(redisUp)('WorkerManager Increment D integration (requires Redis)', () => {
    it('awaits a job result via the descriptor', async () => {
        const app = new App({ name: 'WorkerITResult', logger: { level: 'error' } });
        const wm = new WorkerManager({
            connection: REDIS_URL,
            queueName: `iskra-test-result-${Date.now()}`,
            concurrency: 1,
        });
        wm.register<{ n: number }, number>('double', async (job) => job.data.n * 2);
        await wm.init(app);
        await wm.start();
        try {
            const descriptor = await wm.enqueue<{ n: number }, number>('double', { n: 21 });
            const result = await descriptor.result(5000);
            expect(result).toBe(42);
        } finally {
            await wm.stop();
        }
    });

    it('schedules a repeatable job and processes at least one occurrence', async () => {
        const app = new App({ name: 'WorkerITRepeat', logger: { level: 'error' } });
        const wm = new WorkerManager({
            connection: REDIS_URL,
            queueName: `iskra-test-repeat-${Date.now()}`,
            concurrency: 1,
        });
        let count = 0;
        const fired = new Promise<void>((resolve) => {
            wm.register('tick', async () => {
                count += 1;
                resolve();
            });
        });
        await wm.init(app);
        await wm.start();
        try {
            await wm.schedule('tick', {}, { every: 200 });
            await Promise.race([
                fired,
                new Promise((_r, reject) => setTimeout(() => reject(new Error('repeat never fired')), 5000)),
            ]);
            expect(count).toBeGreaterThanOrEqual(1);
        } finally {
            await wm.stop();
        }
    });

    it('emits worker:dead-letter when a job exhausts its retries', async () => {
        const app = new App({ name: 'WorkerITDead', logger: { level: 'error' } });
        const wm = new WorkerManager({
            connection: REDIS_URL,
            queueName: `iskra-test-dead-${Date.now()}`,
            concurrency: 1,
            deadLetter: true,
        });
        const dead = new Promise<any>((resolve) => {
            app.events.on('worker:dead-letter', (payload: any) => resolve(payload));
        });
        wm.register('always.fail', async () => {
            throw new Error('nope');
        });
        await wm.init(app);
        await wm.start();
        try {
            await wm.enqueue('always.fail', { tag: 'dlq' }, { attempts: 1, backoff: { type: 'fixed', delay: 1 } });
            const payload = await Promise.race([
                dead,
                new Promise((_r, reject) => setTimeout(() => reject(new Error('dead-letter never emitted')), 5000)),
            ]);
            expect(payload.name).toBe('always.fail');
            expect(payload.data).toEqual({ tag: 'dlq' });
            expect(payload.failedReason).toBeDefined();
        } finally {
            await wm.stop();
        }
    });
});
