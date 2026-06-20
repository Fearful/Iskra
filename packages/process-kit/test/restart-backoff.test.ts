import { describe, it, expect, afterEach, mock } from 'bun:test';
import { App } from '@iskra-bun/core';
import { ProcessManager } from '../src/spawner';

/**
 * Fast unit tests for the restart-backoff logic.
 *
 * Strategy: we do NOT wait for real timeouts. Instead we reach into the private
 * state of ProcessManager and call the private methods directly after seeding
 * the process map with controlled fixtures.  This keeps the suite CI-fast.
 */

function makeApp() {
    return new App({ name: 'BackoffTest', logger: { level: 'error' } });
}

function makePm(app: App): ProcessManager {
    const pm = new ProcessManager();
    pm.init(app);
    return pm;
}

/** Build a minimal RunningProcess-shaped object and insert it into pm.processes */
function seedProcess(pm: ProcessManager, name: string, opts: {
    currentBackoffMs: number;
    startedAt?: number;
    restarts?: number;
    restartBackoff?: { initialMs: number; maxMs: number; factor: number };
    restartCooldown?: number;
}) {
    (pm as any).processes.set(name, {
        process: { killed: false, kill: () => {} },
        config: {
            command: 'sleep',
            args: ['1'],
            mode: 'daemon' as const,
            restartOnCrash: true,
            maxRestarts: 10,
            restartCooldown: opts.restartCooldown ?? 60000,
            restartBackoff: opts.restartBackoff,
        },
        name,
        restarts: opts.restarts ?? 0,
        startedAt: opts.startedAt ?? (Date.now() - 100), // crashed quickly
        currentBackoffMs: opts.currentBackoffMs,
    });
}

describe('ProcessManager restart backoff – unit (no real waits)', () => {

    it('computeBackoffMs returns 1000 when no restartBackoff config is set', () => {
        const app = makeApp();
        const pm = makePm(app);
        seedProcess(pm, 'p', { currentBackoffMs: 1000 }); // no restartBackoff
        const procInfo = (pm as any).processes.get('p');
        const delay = (pm as any).computeBackoffMs(procInfo);
        expect(delay).toBe(1000);
    });

    it('computeBackoffMs applies factor to grow the delay', () => {
        const app = makeApp();
        const pm = makePm(app);
        seedProcess(pm, 'p', {
            currentBackoffMs: 1000,
            restartBackoff: { initialMs: 500, maxMs: 30000, factor: 2 },
        });
        const procInfo = (pm as any).processes.get('p');
        const delay = (pm as any).computeBackoffMs(procInfo);
        // 1000 * 2 = 2000, still under maxMs
        expect(delay).toBe(2000);
    });

    it('computeBackoffMs caps at maxMs', () => {
        const app = makeApp();
        const pm = makePm(app);
        seedProcess(pm, 'p', {
            currentBackoffMs: 20000,
            restartBackoff: { initialMs: 500, maxMs: 30000, factor: 2 },
        });
        const procInfo = (pm as any).processes.get('p');
        const delay = (pm as any).computeBackoffMs(procInfo);
        // 20000 * 2 = 40000 → capped at 30000
        expect(delay).toBe(30000);
    });

    it('computeBackoffMs resets to initialMs after stable uptime', () => {
        const app = makeApp();
        const pm = makePm(app);
        // Process was stable for 2× the cooldown, then crashed
        const startedAt = Date.now() - 120000; // 2 minutes ago
        seedProcess(pm, 'p', {
            currentBackoffMs: 16000, // had grown to 16s
            startedAt,
            restartCooldown: 60000,
            restartBackoff: { initialMs: 500, maxMs: 30000, factor: 2 },
        });
        const procInfo = (pm as any).processes.get('p');
        const delay = (pm as any).computeBackoffMs(procInfo);
        // uptime (120s) > cooldown (60s) → reset to initialMs
        expect(delay).toBe(500);
    });

    it('backoff delays grow across successive restarts (integration smoke)', () => {
        /**
         * We capture the sequence of delay values that would be scheduled by
         * intercepting setTimeout. We do NOT let them fire — we immediately
         * clear them. This proves the computed delays grow without any real wait.
         */
        const app = makeApp();
        const pm = makePm(app);

        const scheduledDelays: number[] = [];
        const originalSetTimeout = globalThis.setTimeout;
        // @ts-expect-error – intercept only for this test
        globalThis.setTimeout = (fn: () => void, ms: number) => {
            scheduledDelays.push(ms);
            // Return a fake timer id; don't actually schedule
            return 0 as any;
        };

        try {
            // Seed a fake process that has NOT been alive long (< restartCooldown)
            // so the cooldown reset logic does NOT kick in.
            const startedAt = Date.now() - 100; // crashed after 100ms
            seedProcess(pm, 'crasher', {
                currentBackoffMs: 1000,
                startedAt,
                restarts: 0,
                restartCooldown: 60000,
                restartBackoff: { initialMs: 1000, maxMs: 32000, factor: 2 },
            });

            // Manually simulate a sequence of crashes by calling handleExit and
            // re-seeding the map with the returned delay after each call.
            // handleExit removes the process from the map and calls setTimeout
            // — we intercept the delay but don't let spawnProcess re-add it
            // (because stopping=false but the app is not fully started, so
            // spawnProcess's Bun.spawn would throw; instead we re-seed manually).

            const pm_any = pm as any;

            for (let i = 0; i < 4; i++) {
                // Re-seed with the latest backoff state before each simulated exit
                const latestDelay = scheduledDelays.length > 0
                    ? Math.min(scheduledDelays[scheduledDelays.length - 1] * 2, 32000)
                    : 1000;

                seedProcess(pm, 'crasher', {
                    currentBackoffMs: scheduledDelays.length > 0 ? scheduledDelays[scheduledDelays.length - 1] : 1000,
                    startedAt: Date.now() - 100,
                    restarts: i,
                    restartCooldown: 60000,
                    restartBackoff: { initialMs: 1000, maxMs: 32000, factor: 2 },
                });

                // Calling handleExit will compute delay and call our intercepted setTimeout
                pm_any.handleExit('crasher', 1, 0);
            }
        } finally {
            // Restore real setTimeout
            globalThis.setTimeout = originalSetTimeout;
        }

        // We should have 4 scheduled delays, each larger than the previous
        expect(scheduledDelays.length).toBe(4);
        for (let i = 1; i < scheduledDelays.length; i++) {
            expect(scheduledDelays[i]).toBeGreaterThan(scheduledDelays[i - 1]);
        }
        // First delay should be the initial backoff times factor (since process crashed quickly)
        expect(scheduledDelays[0]).toBe(2000); // 1000 * 2
        // Delays should not exceed maxMs
        for (const d of scheduledDelays) {
            expect(d).toBeLessThanOrEqual(32000);
        }
    });

    it('backoff does not break max-restarts enforcement', () => {
        /**
         * When maxRestarts is reached, handleExit must emit process:max-restarts
         * and NOT schedule a setTimeout, even with backoff configured.
         */
        const app = makeApp();
        const pm = makePm(app);

        const emitted: any[] = [];
        app.on('process:max-restarts', (ctx) => { emitted.push(ctx.payload); });

        const scheduledDelays: number[] = [];
        const originalSetTimeout = globalThis.setTimeout;
        // @ts-expect-error – intercept only for this test
        globalThis.setTimeout = (fn: () => void, ms: number) => {
            scheduledDelays.push(ms);
            return 0 as any;
        };

        try {
            // Process already at maxRestarts limit
            (pm as any).processes.set('maxed', {
                process: { killed: false, kill: () => {} },
                config: {
                    command: 'sleep',
                    args: ['1'],
                    mode: 'daemon' as const,
                    restartOnCrash: true,
                    maxRestarts: 2,
                    restartCooldown: 60000,
                    restartBackoff: { initialMs: 500, maxMs: 30000, factor: 2 },
                },
                name: 'maxed',
                restarts: 2, // already AT maxRestarts
                startedAt: Date.now() - 100,
                currentBackoffMs: 4000,
            });

            (pm as any).handleExit('maxed', 1, 0);
        } finally {
            globalThis.setTimeout = originalSetTimeout;
        }

        // No restart should have been scheduled
        expect(scheduledDelays.length).toBe(0);
        // The max-restarts event must have been emitted
        expect(emitted.length).toBe(1);
        expect(emitted[0].name).toBe('maxed');
    });
});
