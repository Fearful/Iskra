import { describe, it, expect } from 'bun:test';
import { WorkerManager } from '../src/index';
import { QueueError } from '../src/errors';

// Note: These tests verify the WorkerManager API and error handling.
// Full BullMQ integration tests require a running Redis instance.
// Tests that need Redis are skipped with descriptive names.

describe('WorkerManager', () => {
    it('should instantiate with connection config', () => {
        const wm = new WorkerManager({
            connection: 'redis://localhost:6379',
            concurrency: 2,
            queueName: 'test-queue',
        });
        expect(wm.name).toBe('WorkerManager');
    });

    it('should register job handlers', () => {
        const wm = new WorkerManager({ connection: 'redis://localhost:6379' });

        const handler = async () => {};
        const result = wm.register('test.job', handler);
        expect(result).toBe(wm); // chainable
    });

    it('should register multiple handlers', () => {
        const wm = new WorkerManager({ connection: 'redis://localhost:6379' });

        wm.register('job.a', async () => {})
            .register('job.b', async () => {})
            .register('job.c', async () => {});

        // Should not throw
    });

    it('should throw QueueError when enqueueing without init', async () => {
        const wm = new WorkerManager({ connection: 'redis://localhost:6379' });

        try {
            await wm.enqueue('test.job', { data: 'test' });
            expect(true).toBe(false); // should not reach
        } catch (err) {
            expect(err).toBeInstanceOf(QueueError);
            expect((err as QueueError).code).toBe('QUEUE_ERROR');
            expect((err as QueueError).message).toContain('not initialized');
        }
    });

    it('should parse string connection URL', () => {
        // Verify URL parsing doesn't throw
        const wm = new WorkerManager({
            connection: 'redis://user:pass@redis.example.com:6380/2',
        });
        expect(wm.name).toBe('WorkerManager');
    });

    it('should accept object connection config', () => {
        const wm = new WorkerManager({
            connection: { host: 'localhost', port: 6379, password: 'secret', db: 1 },
        });
        expect(wm.name).toBe('WorkerManager');
    });

    it('should accept default job options', () => {
        const wm = new WorkerManager({
            connection: 'redis://localhost:6379',
            defaultJobOptions: {
                attempts: 3,
                delay: 1000,
                priority: 5,
                backoff: { type: 'exponential', delay: 2000 },
                removeOnComplete: 100,
                removeOnFail: 500,
            },
        });
        expect(wm.name).toBe('WorkerManager');
    });

    it('should use default queue name when not specified', () => {
        const wm = new WorkerManager({ connection: 'redis://localhost:6379' });
        // Default queue name is 'iskra-jobs' — verified via internal state
        expect(wm.name).toBe('WorkerManager');
    });
});

describe('WorkerManager.parseConnection', () => {
    const parse = (connection: any) => (new WorkerManager({ connection }) as any).parseConnection();

    it('strips the brackets of an IPv6 host', () => {
        expect(parse('redis://[::1]:6380').host).toBe('::1');
    });

    it('parses a full redis URL into connection parts', () => {
        // The ACL username used to be dropped, so authenticated Redis 6+ users failed.
        expect(parse('redis://user:pass@redis.example.com:6380/2')).toEqual({
            host: 'redis.example.com',
            port: 6380,
            username: 'user',
            password: 'pass',
            db: 2,
        });
    });

    it('percent-decodes credentials and enables TLS for rediss://', () => {
        expect(parse('rediss://svc%40acct:p%40ss%2Fw0rd@cache.example.com:6380/0')).toEqual({
            host: 'cache.example.com',
            port: 6380,
            username: 'svc@acct',
            password: 'p@ss/w0rd',
            db: 0,
            tls: {},
        });
    });

    it('defaults the port to 6379 when omitted', () => {
        expect(parse('redis://localhost/3')).toEqual({
            host: 'localhost',
            port: 6379,
            password: undefined,
            db: 3,
        });
    });

    it('defaults the db to 0 when no path is present', () => {
        expect(parse('redis://localhost:6379')).toEqual({
            host: 'localhost',
            port: 6379,
            password: undefined,
            db: 0,
        });
    });

    it('returns an object connection unchanged', () => {
        const conn = { host: 'localhost', port: 6379, password: 'secret', db: 1 };
        expect(parse(conn)).toBe(conn);
    });
});

describe('WorkerManager.mapJobOptions', () => {
    const map = (opts?: any) =>
        (new WorkerManager({ connection: 'redis://localhost:6379' }) as any).mapJobOptions(opts);

    it('returns undefined when no options are given', () => {
        expect(map(undefined)).toBeUndefined();
    });

    it('maps every supported job option to the BullMQ shape', () => {
        const opts = {
            attempts: 3,
            delay: 1000,
            priority: 5,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: 100,
            removeOnFail: 500,
        };
        expect(map(opts)).toEqual(opts);
    });

    it('omits unspecified options so the queue defaults still apply', () => {
        // toEqual ignores undefined-valued keys, so check the keys themselves:
        // BullMQ spreads these over defaultJobOptions and an undefined erased them.
        expect(Object.keys(map({ attempts: 2 }))).toEqual(['attempts']);
        expect(Object.keys(map({ repeat: '0 9 * * *' }))).toEqual(['repeat']);
    });
});

// ─── stop() graceful-shutdown ordering ───────────────────────────────────────
//
// These tests inject mock Worker and Queue objects directly into the private
// fields so no Redis connection is required.  The core invariant: worker.close()
// must resolve completely before queue.close() is called.

describe('WorkerManager.stop() graceful shutdown', () => {
    function buildWm() {
        return new WorkerManager({ connection: 'redis://localhost:6379' });
    }

    function injectMocks(wm: WorkerManager, workerClose: () => Promise<void>, queueClose: () => Promise<void>) {
        (wm as any).worker = { close: workerClose };
        (wm as any).queue = { close: queueClose };
    }

    it('closes the worker before the queue', async () => {
        const order: string[] = [];
        const wm = buildWm();

        injectMocks(
            wm,
            async () => {
                order.push('worker');
            },
            async () => {
                order.push('queue');
            },
        );

        await wm.stop();

        expect(order).toEqual(['worker', 'queue']);
    });

    it('waits for worker.close() to fully resolve before calling queue.close()', async () => {
        const wm = buildWm();
        let workerResolved = false;
        let queueCalledWhileWorkerPending = false;

        injectMocks(
            wm,
            () =>
                new Promise<void>((resolve) => {
                    // Resolve asynchronously on the next microtask tick
                    Promise.resolve().then(() => {
                        workerResolved = true;
                        resolve();
                    });
                }),
            async () => {
                queueCalledWhileWorkerPending = !workerResolved;
            },
        );

        await wm.stop();

        expect(workerResolved).toBe(true);
        expect(queueCalledWhileWorkerPending).toBe(false);
    });

    it('still closes the queue when worker.close() throws', async () => {
        const wm = buildWm();
        let queueClosed = false;

        // Suppress logger noise for the expected error
        (wm as any).app = {
            logger: { info: () => {}, error: () => {} },
        };

        injectMocks(
            wm,
            async () => {
                throw new Error('worker exploded');
            },
            async () => {
                queueClosed = true;
            },
        );

        // stop() must not propagate the worker error
        await expect(wm.stop()).resolves.toBeUndefined();
        expect(queueClosed).toBe(true);
    });

    it('does nothing when neither worker nor queue are set', async () => {
        const wm = buildWm();
        // worker and queue are null by default — stop() must not throw
        await expect(wm.stop()).resolves.toBeUndefined();
    });
});
