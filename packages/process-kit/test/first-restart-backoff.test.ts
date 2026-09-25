import { describe, it, expect } from 'bun:test';
import { App } from '@iskra-bun/core';
import { ProcessManager } from '../src/spawner';

/**
 * RED test for the "first restart backoff" finding (spawner.ts :148 / :199 / :223).
 *
 * `currentBackoffMs` is seeded to `initialMs` on first spawn, and computeBackoffMs
 * returns `currentBackoffMs * factor`. So the FIRST restart waits `initialMs * factor`
 * instead of `initialMs`. The documented intent is: the first restart uses
 * `initialMs`, and exponential growth begins on the SECOND restart.
 *
 * Desired FIXED behavior (the sequence of scheduled delays for a freshly-spawned,
 * quickly-crashing process with initialMs=1000, factor=2, maxMs=32000):
 *
 *   restart #1 -> 1000   (initialMs, NOT 2000)
 *   restart #2 -> 2000
 *   restart #3 -> 4000
 *
 * Strategy: intercept setTimeout to capture scheduled delays without waiting.
 * We drive handleExit the same way restart-backoff.test.ts does, but we let the
 * manager carry its own backoff state forward (we re-seed each round with the
 * delay it just scheduled, exactly as a real restart would via spawnProcess).
 */

function makeManager() {
    const app = new App({ name: 'FirstBackoffTest', logger: { level: 'error' } });
    const pm = new ProcessManager();
    pm.init(app);
    return { app, pm };
}

describe('ProcessManager first-restart backoff', () => {
    it('first restart waits initialMs (not initialMs * factor)', () => {
        const { pm } = makeManager();
        const initialMs = 1000;

        const scheduled: number[] = [];
        const realSetTimeout = globalThis.setTimeout;
        // @ts-expect-error – intercept only for this test
        globalThis.setTimeout = (_fn: () => void, ms: number) => {
            scheduled.push(ms);
            return 0 as any;
        };

        try {
            // Freshly-spawned process: currentBackoffMs seeded to initialMs, restarts 0,
            // crashed quickly (uptime < cooldown so no reset).
            (pm as any).processes.set('crasher', {
                process: { killed: false, kill: () => {} },
                config: {
                    command: 'sleep',
                    args: ['1'],
                    mode: 'daemon' as const,
                    restartOnCrash: true,
                    maxRestarts: 10,
                    restartCooldown: 60000,
                    restartBackoff: { initialMs, maxMs: 32000, factor: 2 },
                },
                name: 'crasher',
                restarts: 0,
                startedAt: Date.now() - 100,
                currentBackoffMs: initialMs,
            });

            (pm as any).handleExit('crasher', 1, 0);
        } finally {
            globalThis.setTimeout = realSetTimeout;
        }

        expect(scheduled.length).toBe(1);
        // The first restart MUST wait initialMs (1000), not initialMs * factor (2000).
        expect(scheduled[0]).toBe(initialMs);
    });

    it('growth begins on the second restart: 1000 -> 2000 -> 4000', () => {
        const { pm } = makeManager();
        const initialMs = 1000;
        const factor = 2;
        const maxMs = 32000;

        const scheduled: number[] = [];
        const realSetTimeout = globalThis.setTimeout;
        // @ts-expect-error – intercept only for this test
        globalThis.setTimeout = (_fn: () => void, ms: number) => {
            scheduled.push(ms);
            return 0 as any;
        };

        try {
            // Simulate 3 successive quick crashes. After each handleExit we re-seed
            // with currentBackoffMs = the delay just scheduled (mirrors how a real
            // restart threads currentBackoffMs forward through spawnProcess).
            for (let i = 0; i < 3; i++) {
                const carriedBackoff = scheduled.length > 0 ? scheduled[scheduled.length - 1] : initialMs;

                (pm as any).processes.set('crasher', {
                    process: { killed: false, kill: () => {} },
                    config: {
                        command: 'sleep',
                        args: ['1'],
                        mode: 'daemon' as const,
                        restartOnCrash: true,
                        maxRestarts: 10,
                        restartCooldown: 60000,
                        restartBackoff: { initialMs, maxMs, factor },
                    },
                    name: 'crasher',
                    restarts: i,
                    startedAt: Date.now() - 100,
                    currentBackoffMs: carriedBackoff,
                });

                (pm as any).handleExit('crasher', 1, 0);
            }
        } finally {
            globalThis.setTimeout = realSetTimeout;
        }

        expect(scheduled).toEqual([1000, 2000, 4000]);
    });
});
