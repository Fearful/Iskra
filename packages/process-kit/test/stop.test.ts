import { describe, it, expect, afterEach } from 'bun:test';
import { App } from '@iskra-bun/core';
import { ProcessManager } from '../src/spawner';

describe('ProcessManager.stop – graceful shutdown', () => {
    let app: App;
    let pm: ProcessManager;

    afterEach(async () => {
        // Belt-and-suspenders: ensure we always clean up even if a test fails
        try { await pm?.stop(500); } catch { /* already stopped */ }
        try { await app?.stop(); } catch { /* already stopped */ }
    });

    it('awaits process exit before returning (no orphaned process)', async () => {
        app = new App({ name: 'StopTest', logger: { level: 'error' } });
        pm = new ProcessManager();
        app.register(pm);

        app.config.processes = {
            'sleeper': {
                command: 'sleep',
                args: ['10'],
                mode: 'daemon',
            }
        };

        await app.start();

        // Give it a moment to appear in the map
        await new Promise(r => setTimeout(r, 100));

        const exitedBefore = (pm as any).processes.size;
        expect(exitedBefore).toBe(1);

        // stop() must resolve fully — the process should be gone
        await pm.stop(2000);

        // After stop resolves the map must be empty (cleared in stop())
        expect((pm as any).processes.size).toBe(0);
    });

    it('sends SIGTERM (process receives signal 15) before exiting', async () => {
        app = new App({ name: 'SigtermTest', logger: { level: 'error' } });
        pm = new ProcessManager();
        app.register(pm);

        // A bun script that records its signal via a flag file, then exits cleanly on SIGTERM
        const flagFile = `/tmp/iskra-sigterm-test-${process.pid}.txt`;
        await Bun.write(flagFile, '');

        app.config.processes = {
            'sigterm-catcher': {
                command: process.execPath,
                args: [
                    '-e',
                    // Write "SIGTERM" to flagFile when the signal arrives, then exit
                    `process.on('SIGTERM', () => { require('fs').writeFileSync(${JSON.stringify(flagFile)}, 'SIGTERM'); process.exit(0); }); await new Promise(r => setTimeout(r, 30000));`
                ],
                mode: 'daemon',
            }
        };

        await app.start();
        // Wait for process to be running
        await new Promise(r => setTimeout(r, 300));

        await pm.stop(2000);

        const flag = await Bun.file(flagFile).text().catch(() => '');
        // Clean up the temp file
        await Bun.write(flagFile, '').catch(() => {});

        expect(flag).toBe('SIGTERM');
    }, 8000);

    it('force-kills a process that ignores SIGTERM after the timeout', async () => {
        app = new App({ name: 'ForceKillTest', logger: { level: 'error' } });
        pm = new ProcessManager();
        app.register(pm);

        app.config.processes = {
            'sigterm-ignorer': {
                // Use sh to ignore SIGTERM via shell trap; SIGKILL will still terminate it
                command: 'sh',
                args: ['-c', 'trap "" TERM; sleep 30'],
                mode: 'daemon',
            }
        };

        await app.start();
        await new Promise(r => setTimeout(r, 300));

        const t0 = Date.now();
        // Timeout of 300ms graceful — SIGKILL fires at 300ms, deadline at 600ms
        // stop() must return at most at deadline (600ms) not at 30s
        await pm.stop(300);
        const elapsed = Date.now() - t0;

        // stop() must return well before the 30s sleep — give a generous 5s ceiling
        expect(elapsed).toBeLessThan(5000);
        expect((pm as any).processes.size).toBe(0);
    }, 10000);
});
