/**
 * Job result access.
 *
 * `JobHandler<T, R>` may return a value `R`, and `enqueue`/`schedule` return a
 * descriptor whose `result()` awaits that value via BullMQ's
 * `job.waitUntilFinished(queueEvents)`.
 *
 * Unit tests inject a fake Queue whose `add` returns a job with a
 * `waitUntilFinished` stub, so no Redis is required. The real round-trip is
 * covered by a skip-gated integration test in worker.integration.test.ts.
 */
import { describe, it, expect } from 'bun:test';
import { WorkerManager } from '../src/index';
import type { JobHandler } from '../src/types';

function injectStubApp(wm: WorkerManager) {
    (wm as any).app = { logger: { debug: () => {} } };
}

describe('enqueue descriptor result()', () => {
    it('resolves with the value from job.waitUntilFinished', async () => {
        const wm = new WorkerManager({ connection: 'redis://localhost:6379' });
        injectStubApp(wm);

        (wm as any).queue = {
            add: async () => ({
                id: 'job-42',
                waitUntilFinished: async () => ({ sent: true, id: 'mail-1' }),
            }),
        };

        wm.register('email.send', async () => {});
        const descriptor = await wm.enqueue('email.send', { to: 'x@y.com' });
        expect(descriptor.id).toBe('job-42');

        const result = await descriptor.result();
        expect(result).toEqual({ sent: true, id: 'mail-1' });
    });

    it('passes a ttl through to waitUntilFinished', async () => {
        const wm = new WorkerManager({ connection: 'redis://localhost:6379' });
        injectStubApp(wm);

        let receivedTtl: number | undefined;
        (wm as any).queue = {
            add: async () => ({
                id: 'job-7',
                waitUntilFinished: async (_qe: unknown, ttl?: number) => {
                    receivedTtl = ttl;
                    return 'ok';
                },
            }),
        };

        wm.register('slow.job', async () => {});
        const descriptor = await wm.enqueue('slow.job', {});
        const result = await descriptor.result(2500);
        expect(result).toBe('ok');
        expect(receivedTtl).toBe(2500);
    });

    it('reuses a single QueueEvents instance across result() calls', async () => {
        const wm = new WorkerManager({ connection: 'redis://localhost:6379' });
        injectStubApp(wm);

        const seen: unknown[] = [];
        (wm as any).queue = {
            add: async () => ({
                id: 'job-1',
                waitUntilFinished: async (qe: unknown) => {
                    seen.push(qe);
                    return 1;
                },
            }),
        };

        wm.register('a', async () => {});
        wm.register('b', async () => {});
        const d1 = await wm.enqueue('a', {});
        const d2 = await wm.enqueue('b', {});
        await d1.result();
        await d2.result();

        expect(seen).toHaveLength(2);
        expect(seen[0]).toBe(seen[1]); // same QueueEvents instance reused
        expect(seen[0]).toBeDefined();
    });
});

// ─── Typed handler return value compiles ─────────────────────────────────────

describe('JobHandler<T, R> return type', () => {
    it('accepts a handler that returns a value', async () => {
        interface Payload { n: number }

        const handler: JobHandler<Payload, number> = async (job) => job.data.n * 2;

        const out = await handler({ id: '1', name: 'double', data: { n: 21 }, attemptsMade: 0 });
        expect(out).toBe(42);
    });

    it('still accepts a void handler (backward compat)', async () => {
        const handler: JobHandler<{ x: string }> = async (_job) => {};
        const wm = new WorkerManager({ connection: 'redis://localhost:6379' });
        const result = wm.register<{ x: string }>('noop', handler);
        expect(result).toBe(wm);
    });
});
