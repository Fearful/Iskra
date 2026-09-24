import { describe, it, expect } from 'bun:test';
import { join } from 'node:path';
import { App } from '../src/app';
import { LifecycleError } from '../src/errors';
import type { Driver } from '../src/types';

function recorder(log: string[], name: string, opts: { failStart?: boolean; failStop?: boolean } = {}): Driver {
    return {
        name,
        init: () => {},
        start: async () => {
            if (opts.failStart) throw new Error(`${name} failed`);
            log.push(`start:${name}`);
        },
        stop: async () => {
            log.push(`stop:${name}`);
            if (opts.failStop) throw new Error(`${name} stop failed`);
        },
    };
}

describe('App lifecycle', () => {
    it('stops the drivers already started, in reverse, when one fails to start', async () => {
        // Regression: Promise.all left the other drivers running (ports bound).
        const log: string[] = [];
        const app = new App({ name: 'Rollback', logger: { level: 'silent' } });
        app.register(recorder(log, 'db')).register(recorder(log, 'web')).register(recorder(log, 'queue', { failStart: true }));

        await expect(app.start()).rejects.toThrow('queue failed');
        expect(log).toEqual(['start:db', 'start:web', 'stop:web', 'stop:db']);

        // A later stop() does not stop them a second time.
        await app.stop();
        expect(log).toHaveLength(4);
    });

    it('stops drivers in reverse start order and reports every failure', async () => {
        const log: string[] = [];
        const app = new App({ name: 'Reverse', logger: { level: 'silent' } });
        app.register(recorder(log, 'db')).register(recorder(log, 'web', { failStop: true })).register(recorder(log, 'socket'));
        await app.start();

        const err = await app.stop().catch((e) => e);
        expect(err).toBeInstanceOf(LifecycleError);
        expect((err as LifecycleError).failures).toHaveLength(1);
        expect(log.slice(3)).toEqual(['stop:socket', 'stop:web', 'stop:db']);
    });

    it('surfaces an async plugin install failure from start()', async () => {
        // Regression: install() was not awaited, so a rejection was unhandled.
        const app = new App({ name: 'Plugins', logger: { level: 'silent' } });
        app.use({ name: 'broken', install: async () => { throw new Error('plugin boom'); } });
        await expect(app.start()).rejects.toThrow('plugin boom');
    });

    describe('shutdown signals', () => {
        const fixture = join(import.meta.dir, 'fixtures', 'signal-app.ts');

        async function runAndSignal(env: Record<string, string> = {}) {
            const proc = Bun.spawn([process.execPath, fixture], {
                env: { ...process.env, NODE_ENV: 'production', ...env },
                stdout: 'pipe',
                stderr: 'ignore',
            });
            const reader = proc.stdout.getReader();
            let out = '';
            while (!out.includes('ready')) {
                const { value, done } = await reader.read();
                if (done) break;
                out += new TextDecoder().decode(value);
            }
            // Bun 1.1.38 arms a process.on() signal handler slightly after the
            // call returns: a SIGTERM in that window is lost and the process
            // spins (measured ~5% of runs; 0/80 with this pause, 0/40 on Bun
            // 1.3). A real app is not signalled within milliseconds of start.
            await Bun.sleep(100);
            proc.kill('SIGTERM');
            const exitCode = await proc.exited;
            for (;;) {
                const { value, done } = await reader.read();
                if (done) break;
                out += new TextDecoder().decode(value);
            }
            return { exitCode, out };
        }

        // Each case spawns a fresh Bun process; allow for a slow start on a loaded machine.
        const SPAWN_TIMEOUT_MS = 20_000;

        it('stops the app and exits 0 on SIGTERM', async () => {
            const { exitCode, out } = await runAndSignal();
            expect(out).toContain('stopping');
            expect(exitCode).toBe(0);
        }, SPAWN_TIMEOUT_MS);

        it('exits 1 when a graceful stop exceeds shutdownTimeoutMs', async () => {
            const { exitCode, out } = await runAndSignal({ STOP_HANGS: '1', SHUTDOWN_TIMEOUT_MS: '200' });
            expect(out).toContain('stopping');
            expect(exitCode).toBe(1);
        }, SPAWN_TIMEOUT_MS);
    });
});
