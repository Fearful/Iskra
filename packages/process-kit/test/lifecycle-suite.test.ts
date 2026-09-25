import { describe, it, expect, mock } from 'bun:test';
import { App } from '@iskra-bun/core';
import { ProcessManager } from '../src/spawner';

/**
 * Consolidated lifecycle suite requested by the audit:
 *  - oneshot never restarts (handleExit early-return)
 *  - backoff growth + cooldown reset (computeBackoffMs)
 *  - kill() delete-before-terminate (no restart race)
 *  - SIGKILL escalation timer
 *
 * These are fast white-box tests over the private state of ProcessManager.
 * (Orphan detection has its own file: orphan-detection.test.ts.)
 */

function makeManager(name = 'LifecycleTest') {
    const app = new App({ name, logger: { level: 'error' } });
    const pm = new ProcessManager();
    pm.init(app);
    return { app, pm };
}

describe('handleExit – oneshot early return', () => {
    it('oneshot never schedules a restart even with restartOnCrash set', () => {
        const { app, pm } = makeManager();
        const exits: any[] = [];
        app.on('process:exit', (ctx) => {
            exits.push(ctx.payload);
        });

        const scheduled: number[] = [];
        const realSetTimeout = globalThis.setTimeout;
        // @ts-expect-error – intercept only for this test
        globalThis.setTimeout = (_fn: () => void, ms: number) => {
            scheduled.push(ms);
            return 0 as any;
        };

        try {
            (pm as any).processes.set('once', {
                process: { killed: true, kill: () => {} },
                config: {
                    command: process.execPath,
                    args: ['-e', 'process.exit(0)'],
                    mode: 'oneshot' as const,
                    restartOnCrash: true, // must be ignored for oneshot
                },
                name: 'once',
                restarts: 0,
                startedAt: Date.now() - 100,
                currentBackoffMs: 1000,
            });

            (pm as any).handleExit('once', 0, 0);
        } finally {
            globalThis.setTimeout = realSetTimeout;
        }

        // No restart scheduled, and the process is gone from the map.
        expect(scheduled.length).toBe(0);
        expect((pm as any).processes.has('once')).toBe(false);
    });
});

describe('computeBackoffMs – growth and cooldown reset', () => {
    function seed(pm: ProcessManager, over: Partial<any>) {
        (pm as any).processes.set('p', {
            process: { killed: false, kill: () => {} },
            config: {
                command: 'sleep',
                args: ['1'],
                mode: 'daemon' as const,
                restartOnCrash: true,
                restartCooldown: over.restartCooldown ?? 60000,
                restartBackoff: over.restartBackoff,
            },
            name: 'p',
            restarts: 0,
            startedAt: over.startedAt ?? Date.now() - 100,
            currentBackoffMs: over.currentBackoffMs ?? 1000,
        });
        return (pm as any).processes.get('p');
    }

    it('grows by factor while inside the cooldown window', () => {
        const { pm } = makeManager();
        const procInfo = seed(pm, {
            currentBackoffMs: 2000,
            restartBackoff: { initialMs: 1000, maxMs: 30000, factor: 2 },
        });
        expect((pm as any).computeBackoffMs(procInfo)).toBe(4000);
    });

    it('resets to initialMs once uptime exceeds the cooldown', () => {
        const { pm } = makeManager();
        const procInfo = seed(pm, {
            currentBackoffMs: 16000,
            startedAt: Date.now() - 120000, // stable for 2 minutes
            restartCooldown: 60000,
            restartBackoff: { initialMs: 1000, maxMs: 30000, factor: 2 },
        });
        expect((pm as any).computeBackoffMs(procInfo)).toBe(1000);
    });
});

describe('kill() – delete-before-terminate (no restart race)', () => {
    it('removes the process from the map before sending the signal', async () => {
        const { pm } = makeManager();

        let mapHadEntryAtKill = null as boolean | null;
        const proc = {
            killed: false,
            // When kill() is invoked, inspect whether the manager has already
            // removed us from the map (it must, to avoid handleExit restarting us).
            kill: mock(function (this: any) {
                mapHadEntryAtKill = (pm as any).processes.has('racer');
                this.killed = true;
            }),
            exited: Promise.resolve(0),
        };

        (pm as any).processes.set('racer', {
            process: proc,
            config: { command: 'sleep', args: ['1'], mode: 'daemon', restartOnCrash: true },
            name: 'racer',
            restarts: 0,
            startedAt: Date.now(),
            currentBackoffMs: 1000,
        });

        await pm.kill('racer', 30);

        expect(proc.kill).toHaveBeenCalled();
        // At the moment the signal was sent, the entry must already be gone.
        expect(mapHadEntryAtKill).toBe(false);
        expect((pm as any).processes.has('racer')).toBe(false);
    });

    it('an exit firing during kill() does not re-spawn (handleExit no-ops once removed)', () => {
        const { pm } = makeManager();
        const scheduled: number[] = [];
        const realSetTimeout = globalThis.setTimeout;
        // @ts-expect-error – intercept only for this test
        globalThis.setTimeout = (_fn: () => void, ms: number) => {
            scheduled.push(ms);
            return 0 as any;
        };

        try {
            // Simulate kill() having already deleted the entry, then a late exit arriving.
            (pm as any).handleExit('already-gone', 1, 0);
        } finally {
            globalThis.setTimeout = realSetTimeout;
        }

        // handleExit on an absent process must not schedule any restart.
        expect(scheduled.length).toBe(0);
    });
});

describe('kill() – SIGKILL escalation timer', () => {
    it('sends an unsignalled kill() (SIGKILL) after the graceful timeout when SIGTERM is ignored', async () => {
        const { pm } = makeManager();

        const signals: (string | undefined)[] = [];
        let resolveExited: (code: number) => void = () => {};
        const proc: any = {
            killed: false,
            kill: mock(function (this: any, sig?: string) {
                signals.push(sig);
                // Only the escalated, unsignalled kill() actually terminates it.
                if (sig === undefined) {
                    this.killed = true;
                    resolveExited(137);
                }
            }),
            exited: new Promise<number>((r) => {
                resolveExited = r;
            }),
        };

        (pm as any).processes.set('stubborn', {
            process: proc,
            config: { command: 'sleep', args: ['9999'], mode: 'daemon' },
            name: 'stubborn',
            restarts: 0,
            startedAt: Date.now(),
            currentBackoffMs: 1000,
        });

        // gracefulTimeoutMs = 40ms: SIGTERM now, escalation timer fires SIGKILL at 40ms.
        await pm.kill('stubborn', 40);

        // First a SIGTERM, then an escalated unsignalled kill().
        expect(signals[0]).toBe('SIGTERM');
        expect(signals).toContain(undefined);
        expect(proc.killed).toBe(true);
    }, 5000);
});
