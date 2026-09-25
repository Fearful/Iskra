/**
 * Enqueue input validation (DoS hardening).
 *
 * Covers audit finding MEDIUM (src/index.ts:69): `enqueue` forwards untrusted
 * `name`, `data` and `opts.repeat` straight to `queue.add` with no validation.
 * That lets a caller flood Redis with jobs for unknown handlers, store
 * oversized payloads, or push malformed repeat specs.
 *
 * Desired fixed behavior:
 *   - enqueue rejects a `name` that has no registered handler.
 *   - enqueue rejects a `data` payload whose serialized size exceeds a cap.
 *   - enqueue rejects an invalid repeat spec.
 *
 * A fake Queue is injected so no Redis is required. The fake also records
 * whether `add` was reached, so we can assert validation happens BEFORE the
 * job ever touches the queue.
 */
import { describe, it, expect } from 'bun:test';
import { WorkerManager } from '../src/index';
import { QueueError } from '../src/errors';

function fakeQueue() {
    const calls: Array<{ name: string; data: unknown; opts: unknown }> = [];
    return {
        calls,
        add: async (name: string, data: unknown, opts: unknown) => {
            calls.push({ name, data, opts });
            return { id: 'fake-id', waitUntilFinished: async () => undefined };
        },
    };
}

function injectQueue(wm: WorkerManager, queue: ReturnType<typeof fakeQueue>) {
    (wm as any).queue = queue;
    (wm as any).app = { logger: { debug: () => {}, warn: () => {}, error: () => {} } };
}

describe('enqueue validation: unknown handler name', () => {
    it('rejects enqueue for a name with no registered handler', async () => {
        const wm = new WorkerManager({ connection: 'redis://localhost:6379' });
        const q = fakeQueue();
        injectQueue(wm, q);

        await expect(wm.enqueue('not.registered', { ok: true })).rejects.toThrow(QueueError);
    });

    it('does not reach queue.add when the handler is unknown', async () => {
        const wm = new WorkerManager({ connection: 'redis://localhost:6379' });
        const q = fakeQueue();
        injectQueue(wm, q);

        await wm.enqueue('not.registered', { ok: true }).catch(() => {});

        expect(q.calls).toHaveLength(0);
    });

    it('accepts enqueue for a registered handler name', async () => {
        const wm = new WorkerManager({ connection: 'redis://localhost:6379' });
        const q = fakeQueue();
        injectQueue(wm, q);
        wm.register('email.send', async () => {});

        await wm.enqueue('email.send', { to: 'a@b.com' });

        expect(q.calls).toHaveLength(1);
        expect(q.calls[0]!.name).toBe('email.send');
    });
});

describe('enqueue validation: oversized payload', () => {
    it('rejects a data payload that exceeds the serialized size cap', async () => {
        const wm = new WorkerManager({ connection: 'redis://localhost:6379' });
        const q = fakeQueue();
        injectQueue(wm, q);
        wm.register('bulk.import', async () => {});

        // ~5 MB string — far beyond any reasonable per-job payload cap.
        const huge = { blob: 'x'.repeat(5 * 1024 * 1024) };

        await expect(wm.enqueue('bulk.import', huge)).rejects.toThrow(QueueError);
    });

    it('does not reach queue.add for an oversized payload', async () => {
        const wm = new WorkerManager({ connection: 'redis://localhost:6379' });
        const q = fakeQueue();
        injectQueue(wm, q);
        wm.register('bulk.import', async () => {});

        const huge = { blob: 'x'.repeat(5 * 1024 * 1024) };
        await wm.enqueue('bulk.import', huge).catch(() => {});

        expect(q.calls).toHaveLength(0);
    });

    it('accepts a reasonably small payload', async () => {
        const wm = new WorkerManager({ connection: 'redis://localhost:6379' });
        const q = fakeQueue();
        injectQueue(wm, q);
        wm.register('bulk.import', async () => {});

        await wm.enqueue('bulk.import', { rows: [1, 2, 3] });

        expect(q.calls).toHaveLength(1);
    });
});

describe('enqueue validation: invalid repeat spec', () => {
    it('rejects a repeat object missing both pattern and every', async () => {
        const wm = new WorkerManager({ connection: 'redis://localhost:6379' });
        const q = fakeQueue();
        injectQueue(wm, q);
        wm.register('report', async () => {});

        await expect(
            // Neither a cron pattern nor an interval — meaningless repeat spec.
            wm.enqueue('report', {}, { repeat: {} as any }),
        ).rejects.toThrow(QueueError);
    });

    it('rejects a non-positive { every } interval', async () => {
        const wm = new WorkerManager({ connection: 'redis://localhost:6379' });
        const q = fakeQueue();
        injectQueue(wm, q);
        wm.register('heartbeat', async () => {});

        await expect(wm.enqueue('heartbeat', {}, { repeat: { every: 0 } })).rejects.toThrow(QueueError);
    });

    it('rejects an empty cron string repeat', async () => {
        const wm = new WorkerManager({ connection: 'redis://localhost:6379' });
        const q = fakeQueue();
        injectQueue(wm, q);
        wm.register('cron.job', async () => {});

        await expect(wm.enqueue('cron.job', {}, { repeat: '   ' })).rejects.toThrow(QueueError);
    });

    it('still accepts a valid { every } interval', async () => {
        const wm = new WorkerManager({ connection: 'redis://localhost:6379' });
        const q = fakeQueue();
        injectQueue(wm, q);
        wm.register('heartbeat', async () => {});

        await wm.enqueue('heartbeat', {}, { repeat: { every: 5000 } });

        expect(q.calls).toHaveLength(1);
        expect((q.calls[0]!.opts as any).repeat).toEqual({ every: 5000 });
    });
});
