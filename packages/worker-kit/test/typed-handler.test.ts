/**
 * Typed-handler tests.
 *
 * These tests assert that the generic overloads on register<T> and enqueue<T>
 * make job.data typed as T at the call site, and that enqueue<T> enforces the
 * payload shape at compile time.
 *
 * No Redis is required — the tests exercise type-inference through runtime
 * helpers and capture argument values for equality checks.
 */
import { describe, it, expect } from 'bun:test';
import { WorkerManager } from '../src/index';
import type { JobHandler } from '../src/types';

// ─── Payload fixture ──────────────────────────────────────────────────────────

interface SendEmailPayload {
    to: string;
    subject: string;
}

// ─── register<T> — handler receives typed job.data ───────────────────────────

describe('register<T> typed handler', () => {
    it('provides job.data as T inside the handler', async () => {
        const wm = new WorkerManager({ connection: 'redis://localhost:6379' });

        let capturedData: SendEmailPayload | undefined;

        // TypeScript must accept this without a cast.
        // If job.data were `unknown`, the destructure below would be a type error.
        wm.register<SendEmailPayload>('email.send', async (job) => {
            // Destructure directly — only valid when job.data is SendEmailPayload.
            const { to, subject } = job.data;
            capturedData = { to, subject };
        });

        // Drive the handler directly to verify the runtime value.
        const storedHandler = (wm as any).handlers.get('email.send') as JobHandler<SendEmailPayload>;
        expect(storedHandler).toBeDefined();

        await storedHandler({
            id: '1',
            name: 'email.send',
            data: { to: 'a@b.com', subject: 'Hello' },
            attemptsMade: 0,
        });

        expect(capturedData).toEqual({ to: 'a@b.com', subject: 'Hello' });
    });

    it('is chainable and accepts multiple typed handlers', () => {
        interface ResizePayload { url: string; width: number }

        const wm = new WorkerManager({ connection: 'redis://localhost:6379' });

        const result = wm
            .register<SendEmailPayload>('email.send', async (_job) => {})
            .register<ResizePayload>('image.resize', async (_job) => {});

        // Chain returns the WorkerManager instance.
        expect(result).toBe(wm);
    });

    it('accepts an untyped (default T=unknown) handler for backward compat', () => {
        const wm = new WorkerManager({ connection: 'redis://localhost:6379' });

        // No type argument — T defaults to unknown, matching the old any-handler shape.
        const result = wm.register('legacy.job', async (_job) => {});
        expect(result).toBe(wm);
    });
});

// ─── enqueue<T> — payload is type-checked ────────────────────────────────────

describe('enqueue<T> typed payload', () => {
    it('throws QueueError when queue is not initialized (runtime guard)', async () => {
        const wm = new WorkerManager({ connection: 'redis://localhost:6379' });

        // TypeScript accepts enqueue<SendEmailPayload>(...) — if the payload did
        // not match the generic T, the compiler would error here.
        await expect(
            wm.enqueue<SendEmailPayload>('email.send', { to: 'x@y.com', subject: 'Hi' }),
        ).rejects.toThrow('not initialized');
    });

    it('infers T from the data argument without an explicit type parameter', async () => {
        const wm = new WorkerManager({ connection: 'redis://localhost:6379' });

        // T is inferred as { tag: string } — no explicit type arg needed.
        await expect(
            wm.enqueue('some.job', { tag: 'inferred' }),
        ).rejects.toThrow('not initialized');
    });

    it('accepts unknown payload (default T=unknown) for backward compat', async () => {
        const wm = new WorkerManager({ connection: 'redis://localhost:6379' });

        // Old call sites pass data without a type arg — should still compile.
        await expect(
            wm.enqueue('legacy.job', { whatever: true }),
        ).rejects.toThrow('not initialized');
    });
});
