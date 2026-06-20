import { describe, it, expect, mock } from 'bun:test';
import { App } from '@iskra-bun/core';
import { ProcessManager } from '../src/spawner';

/**
 * RED tests for the "silent orphan" finding (spawner.ts kill() :73 and stop() :295).
 *
 * Today kill()/stop() do `Promise.race([proc.exited, sleep(deadline)])` and then
 * resolve normally even if the underlying process never died. The caller believes
 * shutdown succeeded while an orphan keeps running.
 *
 * Desired FIXED behavior: after the race, if the process did NOT actually exit
 * (proc.killed is still false), the manager must log an error via app.logger so
 * the orphan is observable.
 *
 * Strategy: white-box. We seed the private process map with a fake Subprocess
 * whose `exited` promise NEVER resolves and whose `kill()` is a no-op (a process
 * that ignores both SIGTERM and SIGKILL). We use a tiny deadline so the race
 * settles on the timeout branch fast, then assert app.logger.error was called.
 */

function makeManager() {
    const app = new App({ name: 'OrphanTest', logger: { level: 'error' } });
    const pm = new ProcessManager();
    pm.init(app);
    return { app, pm };
}

/** A subprocess that ignores all signals: exited never resolves, kill is a no-op. */
function makeUnkillableProc() {
    return {
        killed: false, // stays false forever — the process never dies
        kill: mock(() => { /* ignores SIGTERM and SIGKILL */ }),
        exited: new Promise<number>(() => { /* never resolves */ }),
    };
}

describe('ProcessManager orphan detection – kill()', () => {
    it('logs an error when the process never exits after SIGTERM + SIGKILL', async () => {
        const { app, pm } = makeManager();
        const errorLog = mock(() => {});
        app.logger.error = errorLog as any;

        const proc = makeUnkillableProc();
        (pm as any).processes.set('zombie', {
            process: proc,
            config: { command: 'sleep', args: ['9999'], mode: 'daemon' },
            name: 'zombie',
            restarts: 0,
            startedAt: Date.now(),
            currentBackoffMs: 1000,
        });

        // Short graceful window so the race resolves on the timeout branch quickly.
        // deadline = gracefulTimeoutMs * 2 = 60ms.
        await pm.kill('zombie', 30);

        // The orphan must be surfaced via an error-level log.
        expect(errorLog).toHaveBeenCalled();
    }, 5000);

    it('does NOT log an error when the process exits cleanly', async () => {
        const { app, pm } = makeManager();
        const errorLog = mock(() => {});
        app.logger.error = errorLog as any;

        const proc = {
            killed: false,
            kill: mock(function (this: any) { this.killed = true; }),
            exited: Promise.resolve(0),
        };
        (pm as any).processes.set('clean', {
            process: proc,
            config: { command: 'sleep', args: ['1'], mode: 'daemon' },
            name: 'clean',
            restarts: 0,
            startedAt: Date.now(),
            currentBackoffMs: 1000,
        });

        await pm.kill('clean', 30);

        // A process that actually exited must NOT be reported as an orphan.
        expect(errorLog).not.toHaveBeenCalled();
    }, 5000);
});

describe('ProcessManager orphan detection – stop()', () => {
    it('logs an error when a process survives SIGTERM + SIGKILL during stop()', async () => {
        const { app, pm } = makeManager();
        const errorLog = mock(() => {});
        app.logger.error = errorLog as any;

        const proc = makeUnkillableProc();
        (pm as any).processes.set('survivor', {
            process: proc,
            config: { command: 'sleep', args: ['9999'], mode: 'daemon' },
            name: 'survivor',
            restarts: 0,
            startedAt: Date.now(),
            currentBackoffMs: 1000,
        });

        await pm.stop(30);

        expect(errorLog).toHaveBeenCalled();
    }, 5000);
});
