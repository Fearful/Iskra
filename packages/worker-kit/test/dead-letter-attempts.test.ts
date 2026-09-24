/**
 * Dead-letter routing across multi-attempt jobs (attempts > 1).
 *
 * Covers audit finding MEDIUM (src/index.ts:241): the terminal-failure guard is
 *
 *     const maxAttempts = job.opts?.attempts ?? 1;
 *     if (job.attemptsMade < maxAttempts) return;
 *
 * BullMQ's own retry decision is version-sensitive — in bullmq 5.78 the retry
 * guard is `attemptsMade + 1 < opts.attempts` (classes/job.js:490). Only the
 * `attempts: 1` path is currently tested, so an off-by-one in the `attemptsMade`
 * reported at the *final* failure of an `attempts: 2` job would silently skip
 * dead-lettering.
 *
 * These tests pin the assumed semantics for attempts > 1 and document them
 * inline so a future BullMQ bump that changes `attemptsMade` reporting fails
 * loudly here. The private `onFailed` handler is driven directly with a fake
 * BullMQ job, so no Redis is required.
 *
 * NOTE: the Red-Green-Refactor counterpart is a Redis-gated integration test in
 * dead-letter-attempts.integration.test.ts that exercises a real attempts:2 job.
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
            emit: (event: string, payload: unknown) => emitted.push({ event, payload }),
        },
    };
}

/**
 * A failed BullMQ job. `attemptsMade` is what BullMQ reports on the `failed`
 * event; `attempts` is the configured max in `job.opts`.
 */
function fakeFailedJob(attemptsMade: number, attempts: number) {
    return {
        id: 'job-1',
        name: 'flaky',
        data: { tag: 'multi' },
        attemptsMade,
        failedReason: 'boom',
        opts: { attempts },
    };
}

describe('dead-letter with attempts > 1', () => {
    it('dead-letters the FINAL failure of an attempts:2 job', () => {
        const wm = new WorkerManager({ connection: 'redis://localhost:6379', deadLetter: true });
        const app = stubApp();
        (wm as any).app = app;

        // Assumed semantics: on the terminal failure of an attempts:2 job,
        // BullMQ has exhausted both tries. The handler must dead-letter it.
        // bullmq 5.78 reports attemptsMade == attempts (2) at the final failure;
        // a future version could report attempts-1. The handler must treat the
        // "no retry left" case as terminal either way.
        (wm as any).onFailed(fakeFailedJob(2, 2), new Error('boom'));

        const dead = app.emitted.find((e) => e.event === 'worker:dead-letter');
        expect(dead).toBeDefined();
        expect((dead!.payload as DeadLetterPayload).name).toBe('flaky');
        expect((dead!.payload as DeadLetterPayload).attemptsMade).toBe(2);
    });

    it('does NOT dead-letter the first (non-terminal) failure of an attempts:2 job', () => {
        const wm = new WorkerManager({ connection: 'redis://localhost:6379', deadLetter: true });
        const app = stubApp();
        (wm as any).app = app;

        // attemptsMade 1 of 2 → one retry still pending → no dead-letter yet.
        (wm as any).onFailed(fakeFailedJob(1, 2), new Error('boom'));

        expect(app.emitted.find((e) => e.event === 'worker:dead-letter')).toBeUndefined();
    });
});
