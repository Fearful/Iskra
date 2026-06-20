/**
 * Scheduled / repeatable jobs.
 *
 * Asserts that the `repeat` option on JobOptions and the `schedule()`
 * convenience method are forwarded to the underlying BullMQ Queue.add as a
 * `repeat` option. A fake Queue is injected so no Redis is required.
 */
import { describe, it, expect } from 'bun:test';
import { WorkerManager } from '../src/index';

// Minimal fake Queue capturing the args passed to add().
function fakeQueue() {
    const calls: Array<{ name: string; data: unknown; opts: any }> = [];
    return {
        calls,
        add: async (name: string, data: unknown, opts: any) => {
            calls.push({ name, data, opts });
            return { id: 'fake-id' };
        },
    };
}

function injectQueue(wm: WorkerManager, queue: ReturnType<typeof fakeQueue>) {
    (wm as any).queue = queue;
    (wm as any).app = { logger: { debug: () => {} } };
}

describe('enqueue with repeat option', () => {
    it('forwards a cron string repeat to Queue.add', async () => {
        const wm = new WorkerManager({ connection: 'redis://localhost:6379' });
        const q = fakeQueue();
        injectQueue(wm, q);

        await wm.enqueue('report.daily', { kind: 'daily' }, { repeat: '0 0 * * *' });

        expect(q.calls).toHaveLength(1);
        expect(q.calls[0]!.opts.repeat).toEqual({ pattern: '0 0 * * *' });
    });

    it('forwards an { every } repeat to Queue.add', async () => {
        const wm = new WorkerManager({ connection: 'redis://localhost:6379' });
        const q = fakeQueue();
        injectQueue(wm, q);

        await wm.enqueue('heartbeat', { ok: true }, { repeat: { every: 5000 } });

        expect(q.calls[0]!.opts.repeat).toEqual({ every: 5000 });
    });

    it('forwards a { pattern } repeat with extra options', async () => {
        const wm = new WorkerManager({ connection: 'redis://localhost:6379' });
        const q = fakeQueue();
        injectQueue(wm, q);

        await wm.enqueue('weekly', {}, { repeat: { pattern: '0 0 * * 0', tz: 'UTC', limit: 4 } });

        expect(q.calls[0]!.opts.repeat).toEqual({ pattern: '0 0 * * 0', tz: 'UTC', limit: 4 });
    });

    it('omits repeat when not provided', async () => {
        const wm = new WorkerManager({ connection: 'redis://localhost:6379' });
        const q = fakeQueue();
        injectQueue(wm, q);

        await wm.enqueue('plain', {});

        expect(q.calls[0]!.opts?.repeat).toBeUndefined();
    });
});

describe('schedule() convenience method', () => {
    it('forwards a cron string as a repeat pattern', async () => {
        const wm = new WorkerManager({ connection: 'redis://localhost:6379' });
        const q = fakeQueue();
        injectQueue(wm, q);

        await wm.schedule('cleanup', { scope: 'tmp' }, '*/15 * * * *');

        expect(q.calls).toHaveLength(1);
        expect(q.calls[0]!.name).toBe('cleanup');
        expect(q.calls[0]!.data).toEqual({ scope: 'tmp' });
        expect(q.calls[0]!.opts.repeat).toEqual({ pattern: '*/15 * * * *' });
    });

    it('forwards an { every } interval', async () => {
        const wm = new WorkerManager({ connection: 'redis://localhost:6379' });
        const q = fakeQueue();
        injectQueue(wm, q);

        await wm.schedule('poll', {}, { every: 1000 });

        expect(q.calls[0]!.opts.repeat).toEqual({ every: 1000 });
    });

    it('merges extra job options alongside the repeat', async () => {
        const wm = new WorkerManager({ connection: 'redis://localhost:6379' });
        const q = fakeQueue();
        injectQueue(wm, q);

        await wm.schedule('digest', {}, { every: 60000 }, { priority: 3, attempts: 2 });

        expect(q.calls[0]!.opts.repeat).toEqual({ every: 60000 });
        expect(q.calls[0]!.opts.priority).toBe(3);
        expect(q.calls[0]!.opts.attempts).toBe(2);
    });

    it('throws QueueError when the queue is not initialized', async () => {
        const wm = new WorkerManager({ connection: 'redis://localhost:6379' });
        await expect(wm.schedule('x', {}, '* * * * *')).rejects.toThrow('not initialized');
    });
});
