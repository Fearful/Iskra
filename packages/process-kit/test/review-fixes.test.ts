import { describe, it, expect, afterAll } from 'bun:test';
import { App } from '@iskra-bun/core';
import { chmodSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProcessManager } from '../src/spawner';

// Real subprocesses: process groups, broken pipes and spawn errors are what
// these tests are about, and mocks would not have them. Each test uses its own
// `sleep` duration so pgrep finds only its processes.

const dir = mkdtempSync(join(tmpdir(), 'process-kit-review-'));
const posix = process.platform !== 'win32';

afterAll(() => {
    Bun.spawnSync(['pkill', '-9', '-f', '^sleep 77[0-9][0-9]']);
    rmSync(dir, { recursive: true, force: true });
});

function makeManager(processes?: Record<string, unknown>) {
    const app = new App({ name: 'ReviewFixes', logger: { level: 'silent' }, shutdownSignals: false, processes } as any);
    const pm = new ProcessManager();
    app.register(pm);
    return { app, pm };
}

function count(pattern: string): number {
    const out = Bun.spawnSync(['pgrep', '-f', pattern]).stdout.toString().trim();
    return out ? out.split('\n').length : 0;
}

async function waitFor(condition: () => boolean, ms = 3000) {
    const deadline = Date.now() + ms;
    while (!condition() && Date.now() < deadline) await Bun.sleep(20);
    return condition();
}

describe.if(posix)('process groups', () => {
    it('kill() SIGKILLs a grandchild that ignores SIGTERM after its wrapper exits', async () => {
        const { app, pm } = makeManager();
        await app.start();
        await pm.spawn('wrapped', {
            command: 'sh',
            args: ['-c', '(trap "" TERM; exec sleep 7701) & wait'],
            mode: 'daemon',
        } as any);
        expect(await waitFor(() => count('^sleep 7701') === 1)).toBe(true);

        // The wrapper exits on SIGTERM; the grandchild used to survive for good.
        await pm.kill('wrapped', 200);
        expect(count('^sleep 7701')).toBe(0);
        await app.stop();
    });

    it('stop() waits for the whole group, not just the direct child', async () => {
        const { app, pm } = makeManager({
            wrapped: { command: 'sh', args: ['-c', '(trap "" TERM; exec sleep 7702) & wait'], mode: 'daemon' },
        });
        await app.start();
        expect(await waitFor(() => count('^sleep 7702') === 1)).toBe(true);

        await pm.stop(200);
        expect(count('^sleep 7702')).toBe(0);
        await (app as any).stop();
    });

    it('terminates the children a crashed process left behind before restarting it', async () => {
        const { app } = makeManager({
            crashy: {
                command: 'sh',
                args: ['-c', 'sleep 7703 & sleep 0.1; exit 1'],
                mode: 'daemon',
                restartOnCrash: true,
                maxRestarts: 3,
                restartBackoff: { initialMs: 50, factor: 1 },
            },
        });
        let maxed = false;
        app.events.on('process:max-restarts', () => {
            maxed = true;
        });
        await app.start();

        expect(await waitFor(() => maxed, 5000)).toBe(true);
        // Every instance left a `sleep 7703`; they used to pile up, one per restart.
        expect(await waitFor(() => count('^sleep 7703') === 0)).toBe(true);
        await (app as any).stop();
    });

    it('restarts only once the children of the crashed instance are gone', async () => {
        // The child left behind takes ~400 ms to exit on SIGTERM, far longer
        // than the 50 ms backoff: the restart used to run next to it.
        const child = `sh -c 'trap "sleep 0.4; exit 0" TERM; while :; do sleep 0.0771; done'`;
        const { app } = makeManager({
            slowchild: {
                command: 'sh',
                args: ['-c', `${child} & sleep 0.1; exit 1`],
                mode: 'daemon',
                restartOnCrash: true,
                maxRestarts: 3,
                restartBackoff: { initialMs: 50, factor: 1 },
            },
        });
        let maxed = false;
        app.events.on('process:max-restarts', () => {
            maxed = true;
        });
        await app.start();

        const pattern = '^sh -c trap .*sleep 0.0771';
        let most = 0;
        const deadline = Date.now() + 8000;
        while (!(maxed && count(pattern) === 0) && Date.now() < deadline) {
            most = Math.max(most, count(pattern));
            await Bun.sleep(20);
        }
        expect(maxed).toBe(true);
        expect(most).toBe(1);
        expect(count(pattern)).toBe(0);
        await (app as any).stop();
    }, 10_000);
});

describe.if(posix)('timers', () => {
    it('stop() leaves no timer keeping the event loop alive', async () => {
        const script = join(dir, 'exit-delay.ts');
        writeFileSync(
            script,
            `import { App } from ${JSON.stringify(Bun.resolveSync('@iskra-bun/core', import.meta.dir))};
import { ProcessManager } from ${JSON.stringify(join(import.meta.dir, '../src/spawner'))};
const app = new App({ name: 't', logger: { level: 'silent' }, shutdownSignals: false,
    processes: { s: { command: 'sleep', args: ['7704'], mode: 'daemon' } } } as any);
app.register(new ProcessManager());
await app.start();
await app.stop();
`,
        );
        const started = Date.now();
        const child = Bun.spawn([process.execPath, script], {
            cwd: import.meta.dir,
            stdout: 'ignore',
            stderr: 'inherit',
        });
        expect(await child.exited).toBe(0);
        // A leftover deadline timer used to hold the process for 2 × 5 s.
        expect(Date.now() - started).toBeLessThan(4000);
    }, 15000);
});

describe.if(posix)('send()', () => {
    it('logs a broken pipe instead of an unhandled rejection', async () => {
        const unhandled: unknown[] = [];
        const onUnhandled = (reason: unknown) => {
            unhandled.push(reason);
        };
        process.on('unhandledRejection', onUnhandled);
        try {
            const { app, pm } = makeManager({
                closed: { command: 'sh', args: ['-c', 'exec 0<&-; sleep 3'], mode: 'stdio' },
            });
            const errors: string[] = [];
            (app.logger as any).error = (_obj: unknown, msg?: string) => {
                errors.push(String(msg));
            };
            await app.start();
            await Bun.sleep(200);

            // Larger than the pipe buffer, so the write completes asynchronously.
            await pm.send('closed', { pad: 'x'.repeat(200_000) });
            await waitFor(() => errors.length > 0, 2000);
            await Bun.sleep(50);

            expect(unhandled).toEqual([]);
            expect(errors.some((m) => m.includes('Failed to write to process closed'))).toBe(true);
            await (app as any).stop(200);
        } finally {
            process.off('unhandledRejection', onUnhandled);
        }
    });
});

describe('spawn errors', () => {
    it('spawn() rejects before the manager is initialized, instead of resolving without a process', async () => {
        const pm = new ProcessManager();
        await expect(pm.spawn('early', { command: 'sleep', args: ['7708'], mode: 'daemon' } as any)).rejects.toThrow(
            'ProcessManager is not initialized: register it on an App first',
        );
    });

    it('spawn() rejects after stop()', async () => {
        const { app, pm } = makeManager();
        await app.start();
        await app.stop();
        await expect(pm.spawn('late', { command: 'sleep', args: ['7709'], mode: 'daemon' } as any)).rejects.toThrow(
            'ProcessManager is stopped',
        );
        expect(count('^sleep 7709')).toBe(0);
    });

    it('spawn() rejects when the command does not exist', async () => {
        const { app, pm } = makeManager();
        await app.start();
        await expect(pm.spawn('ghost', { command: '/no/such/binary', mode: 'daemon' } as any)).rejects.toThrow();
        await expect(pm.kill('ghost')).rejects.toThrow(/not found/);
        await app.stop();
    });

    it('start() reports a process it cannot spawn and keeps the others', async () => {
        const { app, pm } = makeManager({
            ghost: { command: '/no/such/binary', mode: 'daemon' },
            real: { command: 'sleep', args: ['7705'], mode: 'daemon' },
        });
        const failed: string[] = [];
        app.events.on('process:spawn-error', (e: any) => failed.push(e.name));
        await app.start();

        expect(failed).toEqual(['ghost']);
        expect((pm as any).processes.has('real')).toBe(true);
        await (app as any).stop();
    });

    it.if(posix)('keeps supervising when a restart cannot spawn the command', async () => {
        const bin = join(dir, 'flaky.sh');
        writeFileSync(bin, '#!/bin/sh\nexit 1\n');
        chmodSync(bin, 0o755);
        const { app, pm } = makeManager();
        const failed: string[] = [];
        app.events.on('process:spawn-error', (e: any) => failed.push(e.name));
        await app.start();
        await pm.spawn('flaky', {
            command: bin,
            mode: 'daemon',
            restartOnCrash: true,
            maxRestarts: 10,
            restartBackoff: { initialMs: 150, factor: 1 },
        } as any);

        // Gone during the backoff (a redeploy, say), then back.
        await Bun.sleep(50);
        unlinkSync(bin);
        expect(await waitFor(() => failed.length > 0)).toBe(true);
        writeFileSync(bin, '#!/bin/sh\nexec sleep 7706\n');
        chmodSync(bin, 0o755);

        expect(await waitFor(() => count('^sleep 7706') === 1)).toBe(true);
        expect((pm as any).processes.has('flaky')).toBe(true);
        await (app as any).stop();
    });
});
