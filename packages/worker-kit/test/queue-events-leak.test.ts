/**
 * QueueEvents connection leak after stop().
 *
 * Covers audit finding MEDIUM (src/index.ts:164): `result()` lazily opens a
 * shared QueueEvents via `getQueueEvents()`. `stop()` only closes that instance
 * if it was already created, so calling `result()` AFTER `stop()` opens a fresh
 * QueueEvents connection that nothing will ever close — an orphan leak.
 *
 * Desired fixed behavior:
 *   - Once `stop()` has run, `getQueueEvents()` / `result()` throw a clear error
 *     instead of opening a new connection.
 *
 * No Redis is required: a fake Queue is injected and `stop()` is given no-op
 * worker/queue closers. We assert that a post-stop `result()` rejects rather
 * than silently spinning up a connection.
 */
import { describe, it, expect } from 'bun:test';
import { WorkerManager } from '../src/index';
import { QueueError } from '../src/errors';

function injectStubApp(wm: WorkerManager) {
    (wm as any).app = { logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } };
}

function injectFakeQueue(wm: WorkerManager) {
    (wm as any).queue = {
        add: async (name: string) => ({
            id: `job-${name}`,
            // The descriptor's result() calls getQueueEvents() BEFORE awaiting
            // this, so for the leak scenario it should never get here once stopped.
            waitUntilFinished: async () => 'done',
        }),
        close: async () => {},
    };
    // enqueue now validates that a handler exists for the job name; register the
    // handler used by the leak scenarios so enqueue succeeds and the test can
    // exercise the post-stop result() path it actually targets.
    wm.register('email.send', async () => {});
}

describe('result() after stop()', () => {
    it('throws instead of opening an orphan QueueEvents connection', async () => {
        const wm = new WorkerManager({ connection: 'redis://localhost:6379' });
        injectStubApp(wm);
        injectFakeQueue(wm);

        const descriptor = await wm.enqueue('email.send', { to: 'a@b.com' });

        // Tear down before any result() is awaited.
        await wm.stop();

        // A post-stop result() must NOT lazily open a new QueueEvents; it must
        // surface a clear error so the orphan connection is never created.
        await expect(descriptor.result()).rejects.toThrow(QueueError);
    });

    it('getQueueEvents() throws once stop() has run', async () => {
        const wm = new WorkerManager({ connection: 'redis://localhost:6379' });
        injectStubApp(wm);
        injectFakeQueue(wm);

        await wm.stop();

        expect(() => (wm as any).getQueueEvents()).toThrow(QueueError);
    });

    it('the post-stop error message mentions the manager is stopped', async () => {
        const wm = new WorkerManager({ connection: 'redis://localhost:6379' });
        injectStubApp(wm);
        injectFakeQueue(wm);

        const descriptor = await wm.enqueue('email.send', { to: 'a@b.com' });
        await wm.stop();

        await expect(descriptor.result()).rejects.toThrow(/stop/i);
    });
});
