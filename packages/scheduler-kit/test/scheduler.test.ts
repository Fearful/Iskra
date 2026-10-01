import { afterEach, describe, expect, it } from 'bun:test';
import { App } from '@iskra-bun/core';
import { IntervalScheduler, type JobContext, type ScheduledJob } from '../src';

/** A pino-style logger that keeps what it is given. */
function recordingApp() {
    const lines: { level: string; msg: string; obj: Record<string, unknown> }[] = [];
    const at = (level: string) => (obj: Record<string, unknown>, msg: string) => lines.push({ level, msg, obj });
    const logger = { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') };
    return { app: { logger } as unknown as App, lines };
}

const until = async (condition: () => boolean, timeoutMs = 2000) => {
    const deadline = Date.now() + timeoutMs;
    while (!condition()) {
        if (Date.now() > deadline) throw new Error('condition not met in time');
        await Bun.sleep(5);
    }
};

let schedulers: IntervalScheduler[] = [];
function scheduler(options?: ConstructorParameters<typeof IntervalScheduler>[0]) {
    const s = new IntervalScheduler(options);
    const recorded = recordingApp();
    s.init(recorded.app);
    schedulers.push(s);
    return { s, lines: recorded.lines };
}

afterEach(async () => {
    for (const s of schedulers) await s.stop();
    schedulers = [];
});

describe('IntervalScheduler', () => {
    it('runs a job every interval with its data and a signal', async () => {
        const { s } = scheduler();
        const runs: ScheduledJob<{ board: string }>[] = [];
        const signals: AbortSignal[] = [];
        s.register<{ board: string }>('sync', async (job, { signal }) => {
            runs.push(job);
            signals.push(signal);
        });
        const descriptor = await s.schedule('sync', { board: 'b1' }, { every: 20 });
        expect(descriptor).toEqual({ id: 'sync', name: 'sync', data: { board: 'b1' } });
        await Bun.sleep(30);
        expect(runs).toHaveLength(0); // not before start()

        s.start();
        await until(() => runs.length >= 2);
        expect(runs[0]).toEqual({ id: 'sync:1', name: 'sync', data: { board: 'b1' }, attemptsMade: 0 });
        expect(runs[1]!.id).toBe('sync:2');
        expect(signals[0]).toBeInstanceOf(AbortSignal);
        expect(signals[0]!.aborted).toBe(false);
    });

    it('runs on start when asked, and right away when scheduled after start', async () => {
        const { s } = scheduler();
        let runs = 0;
        s.register('first', async () => void runs++);
        await s.schedule('first', null, { every: 60_000 }, { runOnStart: true });
        s.start();
        await until(() => runs === 1);

        let late = 0;
        s.register('late', async () => void late++);
        await s.schedule('late', null, { every: 60_000 }, { runOnStart: true });
        await until(() => late === 1);
        expect(s.status('late').nextRunAt!.getTime()).toBeGreaterThan(Date.now() + 50_000);
    });

    it('skips a run while the previous one is still in progress', async () => {
        const { s } = scheduler();
        let concurrent = 0;
        let maxConcurrent = 0;
        let runs = 0;
        s.register('slow', async () => {
            runs++;
            maxConcurrent = Math.max(maxConcurrent, ++concurrent);
            await Bun.sleep(70);
            concurrent--;
        });
        await s.schedule('slow', null, { every: 20 }, { timeoutMs: 1000, runOnStart: true });
        s.start();
        await until(() => runs >= 2, 3000);
        expect(maxConcurrent).toBe(1);
        expect(s.status('slow').skipped).toBeGreaterThanOrEqual(2);
    });

    it('logs a failed run and goes on with the schedule', async () => {
        const { s, lines } = scheduler();
        let calls = 0;
        s.register('flaky', async () => {
            calls++;
            if (calls <= 2) throw Object.assign(new Error('token https://x/?t=secret refused'), { code: 'E_REFUSED' });
            return { synced: 12 };
        });
        await s.schedule('flaky', null, { every: 15 }, { runOnStart: true });
        s.start();

        await until(() => s.status('flaky').failures === 2);
        let status = s.status('flaky');
        expect(status.consecutiveFailures).toBe(2);
        expect(status.lastRun!.ok).toBe(false);
        expect(status.lastError).toMatchObject({ name: 'Error', code: 'E_REFUSED' });
        expect(lines.filter((l) => l.level === 'error' && l.msg === 'Job run failed')).toHaveLength(2);

        await until(() => s.status('flaky').lastRun?.ok === true);
        status = s.status('flaky');
        expect(status.consecutiveFailures).toBe(0);
        expect(status.lastRun!.result).toEqual({ synced: 12 });
        expect(status.lastSuccessAt).toBeInstanceOf(Date);
        // Kept for diagnosis until a later failure replaces it.
        expect(status.lastError!.code).toBe('E_REFUSED');
    });

    it('aborts the signal of a run that exceeds its timeout', async () => {
        const { s, lines } = scheduler();
        let reason: unknown;
        s.register('hangs', async (_job, { signal }) => {
            await new Promise<void>((resolve) =>
                signal.addEventListener('abort', () => {
                    reason = signal.reason;
                    resolve();
                }),
            );
            throw signal.reason;
        });
        await s.schedule('hangs', null, { every: 60_000 }, { runOnStart: true, timeoutMs: 30 });
        s.start();
        await until(() => s.status('hangs').failures === 1);
        expect((reason as DOMException).name).toBe('TimeoutError');
        expect(s.status('hangs').lastError!.name).toBe('TimeoutError');
        expect(lines.some((l) => l.level === 'warn' && l.msg.includes('timed out'))).toBe(true);
    });

    it('shows a run that ignores its aborted signal as stuck', async () => {
        const { s } = scheduler({ shutdownTimeoutMs: 50 });
        s.register('deaf', async () => {
            await Bun.sleep(400);
        });
        await s.schedule('deaf', null, { every: 60_000 }, { runOnStart: true, timeoutMs: 20 });
        const health = s.healthCheck('deaf');
        s.start();
        await until(() => s.status('deaf').stuck);
        const result = await health();
        expect(result.status).toBe('error');
        expect(result.message).toContain('stuck');
    });

    it('counts a run that outlives its timeout as failed, even when it ends well later', async () => {
        const { s } = scheduler();
        s.register('late', async () => {
            await Bun.sleep(80);
            return { synced: 1 };
        });
        await s.schedule('late', null, { every: 60_000 }, { runOnStart: true, timeoutMs: 20 });
        const health = s.healthCheck('late', { maxConsecutiveFailures: 1 });
        s.start();
        await until(() => s.status('late').lastRun !== undefined);

        const status = s.status('late');
        expect(status.lastRun!.ok).toBe(false);
        expect(status.lastRun!.result).toBeUndefined();
        expect(status.failures).toBe(1);
        expect(status.lastError!.name).toBe('TimeoutError');
        expect(status.lastSuccessAt).toBeUndefined();
        expect((await health()).status).toBe('error');
    });

    it('stops a job after `limit` runs', async () => {
        const { s } = scheduler();
        let runs = 0;
        s.register('twice', async () => void runs++);
        await s.schedule('twice', null, { every: 10, limit: 2 });
        s.start();
        await until(() => runs === 2);
        await Bun.sleep(50);
        expect(runs).toBe(2);
        expect(s.status('twice').nextRunAt).toBeUndefined();
    });

    it('refuses a job without handler, twice, with a bad interval or after stop', async () => {
        const { s } = scheduler();
        await expect(s.schedule('nobody', null, { every: 10 })).rejects.toThrow('No handler registered');
        s.register('job', async () => {});
        await expect(s.schedule('job', null, { every: 0 })).rejects.toThrow('positive integer');
        await expect(s.schedule('job', null, '*/5 * * * *' as unknown as { every: number })).rejects.toThrow(
            'only intervals',
        );
        await s.schedule('job', null, { every: 10 });
        await expect(s.schedule('job', null, { every: 10 })).rejects.toThrow('already scheduled');
        await s.stop();
        await expect(s.schedule('other', null, { every: 10 })).rejects.toThrow('is stopped');
        expect(() => s.start()).toThrow('cannot start again');
    });
});

describe('IntervalScheduler.stop()', () => {
    it('aborts the run in progress and waits for it', async () => {
        const { s } = scheduler();
        let ended = false;
        let reason: unknown;
        s.register('long', async (_job, { signal }: JobContext) => {
            await new Promise((resolve) => signal.addEventListener('abort', resolve));
            reason = signal.reason;
            await Bun.sleep(20); // cleanup after the abort
            ended = true;
        });
        await s.schedule('long', null, { every: 60_000 }, { runOnStart: true, timeoutMs: 60_000 });
        s.start();
        await until(() => s.status('long').running);

        await s.stop();
        expect(ended).toBe(true);
        expect((reason as DOMException).name).toBe('AbortError');
        expect(s.status('long').running).toBe(false);
    });

    it('gives up after shutdownTimeoutMs on a run that ignores the signal', async () => {
        const { s, lines } = scheduler({ shutdownTimeoutMs: 40 });
        s.register('deaf', async () => {
            await Bun.sleep(500);
        });
        await s.schedule('deaf', null, { every: 60_000 }, { runOnStart: true, timeoutMs: 60_000 });
        s.start();
        await until(() => s.status('deaf').running);

        const started = Date.now();
        await s.stop();
        expect(Date.now() - started).toBeLessThan(300);
        expect(lines.some((l) => l.level === 'warn' && l.msg.includes('did not end'))).toBe(true);
    });

    it('starts no new runs once stopped', async () => {
        const { s } = scheduler();
        let runs = 0;
        s.register('tick', async () => void runs++);
        await s.schedule('tick', null, { every: 10 });
        s.start();
        await until(() => runs >= 1);
        await s.stop();
        const after = runs;
        await Bun.sleep(50);
        expect(runs).toBe(after);
    });
});

describe('IntervalScheduler.healthCheck()', () => {
    it('reports the last run and the last error without its message', async () => {
        const { s } = scheduler();
        s.register('sync', async () => {
            throw new Error('https://gitlab.example.com/api?private_token=secret failed');
        });
        await s.schedule('sync', null, { every: 60_000 }, { runOnStart: true });
        const health = s.healthCheck('sync', { maxConsecutiveFailures: 1 });
        s.start();
        await until(() => s.status('sync').failures === 1);

        const result = await health();
        expect(result.status).toBe('error');
        expect(result.message).toBe('1 failed runs in a row');
        expect(result.details).toMatchObject({
            running: false,
            runs: 1,
            failures: 1,
            consecutiveFailures: 1,
            lastRun: { ok: false },
            lastError: { name: 'Error' },
        });
        expect(JSON.stringify(result)).not.toContain('secret');
    });

    it('passes below maxConsecutiveFailures and includes the result only when asked', async () => {
        const { s } = scheduler();
        s.register('sync', async () => ({ synced: 3 }));
        await s.schedule('sync', null, { every: 60_000 }, { runOnStart: true });
        s.start();
        await until(() => s.status('sync').lastRun !== undefined);

        const plain = await s.healthCheck('sync')();
        expect(plain.status).toBe('ok');
        expect((plain.details.lastRun as Record<string, unknown>).result).toBeUndefined();
        const withResult = await s.healthCheck('sync', { includeResult: true })();
        expect((withResult.details.lastRun as Record<string, unknown>).result).toEqual({ synced: 3 });
    });

    it('fails when no run succeeded within maxStalenessMs, and for a job not scheduled', async () => {
        const { s } = scheduler();
        s.register('never', async () => {});
        await s.schedule('never', null, { every: 60_000 });
        s.start();
        const health = s.healthCheck('never', { maxStalenessMs: 20 });
        expect((await health()).status).toBe('ok');
        await Bun.sleep(40);
        expect(await health()).toMatchObject({ status: 'error', message: 'no successful run yet' });

        expect(await s.healthCheck('missing')()).toEqual({ status: 'error', message: 'not scheduled', details: {} });
    });
});

describe('IntervalScheduler as an App driver', () => {
    it('starts and stops with the App', async () => {
        const app = new App({ name: 'jobs', logger: { level: 'silent' }, shutdownSignals: false });
        const jobs = new IntervalScheduler();
        let runs = 0;
        jobs.register('tick', async () => void runs++);
        await jobs.schedule('tick', null, { every: 10 }, { runOnStart: true });
        app.register(jobs);
        await app.start();
        await until(() => runs >= 2);
        await app.stop();
        const after = runs;
        await Bun.sleep(40);
        expect(runs).toBe(after);
    });
});

describe('IntervalScheduler.readinessCheck()', () => {
    it('is ready once started and while the job is healthy', async () => {
        const { s } = scheduler();
        let fail = false;
        s.register('sync', async () => {
            if (fail) throw new Error('down');
        });
        await s.schedule('sync', null, { every: 15 }, { runOnStart: true });
        const ready = s.readinessCheck('sync', { maxConsecutiveFailures: 2 });
        expect(await ready()).toBe(false); // not started

        s.start();
        await until(() => s.status('sync').lastRun?.ok === true);
        expect(await ready()).toBe(true);

        fail = true;
        await until(() => s.status('sync').consecutiveFailures >= 2);
        expect(await ready()).toBe(false);

        fail = false;
        await until(() => s.status('sync').consecutiveFailures === 0);
        expect(await ready()).toBe(true);
        await s.stop();
        expect(await ready()).toBe(false);
    });
});
