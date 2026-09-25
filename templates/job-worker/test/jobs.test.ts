import { describe, it, expect } from 'bun:test';
import type { App } from '@iskra-bun/core';
import type { JobHandler, WorkerManager } from '@iskra-bun/worker-kit';
import { config, demoEnabled } from '../src/app.config.ts';
import { createDlq } from '../src/dlq.ts';
import { registerJobs } from '../src/jobs.ts';

/** An App whose logger records every call. */
function fakeApp() {
    const logged: unknown[] = [];
    const log = (...args: unknown[]) => void logged.push(args);
    const app = { logger: { info: log, warn: log, error: log, debug: log } } as unknown as App;
    return { app, logged };
}

/** A WorkerManager that only keeps what is registered and enqueued. */
function fakeWorker() {
    const handlers = new Map<string, JobHandler>();
    const enqueued: unknown[] = [];
    const worker = {
        register: (name: string, handler: JobHandler) => handlers.set(name, handler),
        enqueue: async (name: string, data: unknown) => void enqueued.push({ name, data }),
    } as unknown as WorkerManager;
    return { worker, handlers, enqueued };
}

const payload = { to: 'ana@example.com', resetToken: 'reset-SECRET-123' };

describe('job-worker', () => {
    it('keeps job payloads out of the logs', async () => {
        const { app, logged } = fakeApp();
        const { worker, handlers } = fakeWorker();
        const dlq = fakeWorker();
        registerJobs(app, worker, dlq.worker);

        await handlers.get('email.send')!({ id: 'job-1', name: 'email.send', data: payload, attemptsMade: 0 });
        // The last attempt of a failing job goes to the DLQ (with its data) and is logged.
        await handlers.get('flaky.task')!({
            id: 'job-2',
            name: 'flaky.task',
            data: payload,
            attemptsMade: config.retry.attempts - 1,
        });

        const logs = JSON.stringify(logged);
        expect(logs).toContain('job-1');
        expect(logs).not.toContain('reset-SECRET-123');
        expect(logs).not.toContain('ana@example.com');
        expect(dlq.enqueued).toHaveLength(1);
    });

    it('bounds what the dead-letter queue keeps in Redis, and does not log it either', async () => {
        const { app, logged } = fakeApp();
        const dlq = createDlq(app) as unknown as {
            options: { defaultJobOptions: { removeOnComplete: unknown; removeOnFail: unknown } };
            handlers: Map<string, JobHandler>;
        };
        // `false` kept every dead letter, payload included, forever.
        expect(dlq.options.defaultJobOptions.removeOnComplete).toBe(config.dlq.keep);
        expect(dlq.options.defaultJobOptions.removeOnFail).toBe(config.dlq.keep);

        await dlq.handlers.get('dead-letter')!({
            id: 'dl-1',
            name: 'dead-letter',
            data: { originalJob: 'email.send', data: payload, attemptsMade: 3, error: 'boom', failedAt: 'now' },
            attemptsMade: 0,
        });
        expect(JSON.stringify(logged)).not.toContain('reset-SECRET-123');
    });

    it('runs the demo producers only outside production unless DEMO says so', () => {
        // The Dockerfile sets no DEMO: the demo jobs ran in production.
        expect(demoEnabled(undefined, true)).toBe(false);
        expect(demoEnabled(undefined, false)).toBe(true);
        expect(demoEnabled('true', true)).toBe(true);
        expect(demoEnabled('false', false)).toBe(false);
    });
});
