import { describe, test, expect } from 'bun:test';
import { IskraError } from '@iskra-bun/core';
import { QueueError, JobError } from '../src/errors';
import type { WorkerManagerOptions, JobOptions, JobHandler } from '../src/types';

// Unit coverage for worker-kit's error types. types.ts contains only
// compile-time interfaces (no runtime type guards exist to exercise), so the
// type-level checks below are structural assignments verified by tsc.

describe('worker-kit errors', () => {
    test('QueueError carries the QUEUE_ERROR code and its own name', () => {
        const err = new QueueError('queue down');
        expect(err).toBeInstanceOf(IskraError);
        expect(err).toBeInstanceOf(Error);
        expect(err.code).toBe('QUEUE_ERROR');
        expect(err.name).toBe('QueueError');
        expect(err.message).toBe('queue down');
        expect(err.context).toEqual({});
    });

    test('QueueError preserves cause and context', () => {
        const cause = new Error('ECONNREFUSED');
        const err = new QueueError('init failed', {
            cause,
            context: { queueName: 'iskra-jobs' },
        });
        expect(err.cause).toBe(cause);
        expect(err.context).toEqual({ queueName: 'iskra-jobs' });
    });

    test('JobError carries the JOB_ERROR code and its own name', () => {
        const err = new JobError('job blew up');
        expect(err).toBeInstanceOf(IskraError);
        expect(err.code).toBe('JOB_ERROR');
        expect(err.name).toBe('JobError');
    });

    test('JobError preserves cause and context', () => {
        const cause = new Error('handler threw');
        const err = new JobError('Job "email" failed', {
            cause,
            context: { jobId: '42', jobName: 'email', attemptsMade: 2 },
        });
        expect(err.cause).toBe(cause);
        expect(err.context).toEqual({ jobId: '42', jobName: 'email', attemptsMade: 2 });
    });

    test('error types are distinguishable by their code', () => {
        const a: IskraError = new QueueError('a');
        const b: IskraError = new JobError('b');
        expect(a.code).not.toBe(b.code);
    });
});

describe('worker-kit types (structural)', () => {
    test('WorkerManagerOptions accepts a string connection', () => {
        const opts: WorkerManagerOptions = { connection: 'redis://localhost:6379' };
        expect(opts.connection).toBe('redis://localhost:6379');
    });

    test('WorkerManagerOptions accepts an object connection with all fields', () => {
        const opts: WorkerManagerOptions = {
            connection: { host: 'localhost', port: 6379, password: 'secret', db: 1 },
            concurrency: 4,
            queueName: 'custom',
            defaultJobOptions: { attempts: 3 },
        };
        expect(opts.concurrency).toBe(4);
        expect(typeof opts.connection === 'object' && opts.connection.host).toBe('localhost');
    });

    test('JobOptions supports fixed and exponential backoff shapes', () => {
        const fixed: JobOptions = { backoff: { type: 'fixed', delay: 1000 } };
        const exp: JobOptions = { backoff: { type: 'exponential', delay: 2000 } };
        expect(fixed.backoff?.type).toBe('fixed');
        expect(exp.backoff?.type).toBe('exponential');
    });

    test('JobHandler is callable and returns a promise', async () => {
        let received: { id: string; name: string } | null = null;
        const handler: JobHandler = async (job) => {
            received = { id: job.id, name: job.name };
        };
        const result = handler({ id: '1', name: 'test', data: {}, attemptsMade: 0 });
        expect(result).toBeInstanceOf(Promise);
        await result;
        // `received` is mutated inside the async handler; TS cannot see that
        // through control-flow analysis, so widen back from the `null` literal.
        expect(received as { id: string; name: string } | null).toEqual({ id: '1', name: 'test' });
    });
});
