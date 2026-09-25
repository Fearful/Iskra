/**
 * Dead-letter routing.
 *
 * When `deadLetter` is enabled and a job exhausts all its retries, the
 * WorkerManager emits a `worker:dead-letter` event on the App event bus
 * carrying the job name, data and failedReason.
 *
 * No Redis is required: the private `onFailed` handler is driven directly with
 * a fake BullMQ job and a stub App whose event bus captures emissions.
 */
import { describe, it, expect } from 'bun:test';
import { WorkerManager } from '../src/index';
import type { DeadLetterPayload } from '../src/types';

function stubApp() {
    const emitted: Array<{ event: string; payload: unknown }> = [];
    return {
        emitted,
        logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
        events: {
            emit: (event: string, payload: unknown) => {
                emitted.push({ event, payload });
            },
        },
    };
}

function fakeFailedJob(
    over: Partial<{
        id: string;
        name: string;
        data: unknown;
        attemptsMade: number;
        attempts: number;
        failedReason: string;
    }>,
) {
    return {
        id: over.id ?? 'job-1',
        name: over.name ?? 'send.email',
        data: over.data ?? { to: 'a@b.com' },
        attemptsMade: over.attemptsMade ?? 3,
        failedReason: over.failedReason ?? 'boom',
        opts: { attempts: over.attempts ?? 3 },
    };
}

describe('dead-letter routing (opt-in)', () => {
    it('emits worker:dead-letter when retries are exhausted', () => {
        const wm = new WorkerManager({ connection: 'redis://localhost:6379', deadLetter: true });
        const app = stubApp();
        (wm as any).app = app;

        const job = fakeFailedJob({ attemptsMade: 3, attempts: 3, failedReason: 'kaput' });
        (wm as any).onFailed(job, new Error('kaput'));

        const dead = app.emitted.find((e) => e.event === 'worker:dead-letter');
        expect(dead).toBeDefined();
        const payload = dead!.payload as DeadLetterPayload;
        expect(payload.jobId).toBe('job-1');
        expect(payload.name).toBe('send.email');
        expect(payload.data).toEqual({ to: 'a@b.com' });
        expect(payload.failedReason).toBe('kaput');
        expect(payload.attemptsMade).toBe(3);
    });

    it('does NOT emit when there are retries remaining', () => {
        const wm = new WorkerManager({ connection: 'redis://localhost:6379', deadLetter: true });
        const app = stubApp();
        (wm as any).app = app;

        const job = fakeFailedJob({ attemptsMade: 1, attempts: 3 });
        (wm as any).onFailed(job, new Error('transient'));

        expect(app.emitted.find((e) => e.event === 'worker:dead-letter')).toBeUndefined();
    });

    it('does NOT emit when deadLetter is disabled (default)', () => {
        const wm = new WorkerManager({ connection: 'redis://localhost:6379' });
        const app = stubApp();
        (wm as any).app = app;

        const job = fakeFailedJob({ attemptsMade: 3, attempts: 3 });
        (wm as any).onFailed(job, new Error('kaput'));

        expect(app.emitted.find((e) => e.event === 'worker:dead-letter')).toBeUndefined();
    });

    it('treats a single-attempt job (no explicit attempts) as exhausted', () => {
        const wm = new WorkerManager({ connection: 'redis://localhost:6379', deadLetter: true });
        const app = stubApp();
        (wm as any).app = app;

        // attempts omitted → BullMQ default is 1; attemptsMade 1 means exhausted.
        const job = { id: 'j', name: 'once', data: {}, attemptsMade: 1, failedReason: 'x', opts: {} };
        (wm as any).onFailed(job, new Error('x'));

        expect(app.emitted.find((e) => e.event === 'worker:dead-letter')).toBeDefined();
    });

    it('does not throw when job is undefined', () => {
        const wm = new WorkerManager({ connection: 'redis://localhost:6379', deadLetter: true });
        (wm as any).app = stubApp();
        expect(() => (wm as any).onFailed(undefined, new Error('x'))).not.toThrow();
    });
});
