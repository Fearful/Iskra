/**
 * Dead-letter routing for an attempts:2 job against real Redis.
 *
 * Covers audit finding MEDIUM (src/index.ts:241). The existing integration
 * suite only exercises attempts:1. BullMQ's `attemptsMade` reporting at the
 * terminal failure is version-sensitive, so this test runs a real always-failing
 * job with `attempts: 2` and asserts that exactly one `worker:dead-letter` event
 * is emitted — on the FINAL failure, not the intermediate retry.
 *
 * Skipped when no Redis is reachable, matching worker.integration.test.ts.
 * Point at a custom instance with TEST_REDIS_URL.
 */
import { describe, it, expect } from 'bun:test';
import { WorkerManager } from '../src/index';
import { App } from '@iskra-bun/core';

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

describe.if(redisUp)('dead-letter attempts:2 integration (requires Redis)', () => {
    it('emits exactly one dead-letter on the final failure of an attempts:2 job', async () => {
        const app = new App({ name: 'WorkerITDead2', logger: { level: 'error' } });
        const wm = new WorkerManager({
            connection: REDIS_URL,
            queueName: `iskra-test-dead2-${Date.now()}`,
            concurrency: 1,
            deadLetter: true,
        });

        const deadEvents: any[] = [];
        app.events.on('worker:dead-letter', (payload: any) => deadEvents.push(payload));

        let runs = 0;
        wm.register('always.fail.twice', async () => {
            runs += 1;
            throw new Error('nope');
        });

        await wm.init(app);
        await wm.start();
        try {
            await wm.enqueue(
                'always.fail.twice',
                { tag: 'dlq2' },
                { attempts: 2, backoff: { type: 'fixed', delay: 1 } },
            );

            // Wait until both attempts have run and the dead-letter has landed.
            await Promise.race([
                new Promise<void>((resolve) => {
                    const timer = setInterval(() => {
                        if (deadEvents.length >= 1 && runs >= 2) {
                            clearInterval(timer);
                            resolve();
                        }
                    }, 50);
                }),
                new Promise((_r, reject) =>
                    setTimeout(() => reject(new Error('dead-letter never emitted for attempts:2 job')), 8000),
                ),
            ]);

            // The handler ran twice (attempts:2) and dead-lettered exactly once.
            expect(runs).toBe(2);
            expect(deadEvents).toHaveLength(1);
            expect(deadEvents[0].name).toBe('always.fail.twice');
            expect(deadEvents[0].data).toEqual({ tag: 'dlq2' });
        } finally {
            await wm.stop();
        }
    });
});
