import { describe, it, expect, afterEach } from 'bun:test';
import { App } from '@iskra-bun/core';
import { ProcessManager } from '../src/spawner';

describe('ProcessManager oneshot mode', () => {
    let app: App;
    let pm: ProcessManager;

    afterEach(async () => {
        try { await pm?.stop(500); } catch { /* already stopped */ }
        try { await app?.stop(); } catch { /* already stopped */ }
    });

    it('does NOT restart after a clean exit', async () => {
        app = new App({ name: 'OneshotTest', logger: { level: 'error' } });
        pm = new ProcessManager();
        app.register(pm);

        app.config.processes = {
            'setup-task': {
                command: process.execPath,
                args: ['-e', 'process.exit(0)'],
                mode: 'oneshot',
                restartOnCrash: true, // even with restartOnCrash set, oneshot must NOT restart
            }
        };

        const exitPromise = new Promise<any>(resolve => {
            app.on('process:exit', (ctx) => resolve(ctx.payload));
        });

        await app.start();

        // Wait for exit event
        const result = await Promise.race([
            exitPromise,
            new Promise(r => setTimeout(() => r('timeout'), 3000)),
        ]);

        expect(result).not.toBe('timeout');
        expect(result.name).toBe('setup-task');

        // Give any potential (incorrect) restart a moment to happen
        await new Promise(r => setTimeout(r, 1200));

        // The process must NOT be in the map (no restart happened)
        expect((pm as any).processes.has('setup-task')).toBe(false);
    }, 6000);

    it('does NOT restart after a non-zero exit', async () => {
        app = new App({ name: 'OneshotCrashTest', logger: { level: 'error' } });
        pm = new ProcessManager();
        app.register(pm);

        app.config.processes = {
            'failing-task': {
                command: process.execPath,
                args: ['-e', 'process.exit(1)'],
                mode: 'oneshot',
                restartOnCrash: true,
            }
        };

        const exitPromise = new Promise<any>(resolve => {
            app.on('process:exit', (ctx) => resolve(ctx.payload));
        });

        await app.start();

        const result = await Promise.race([
            exitPromise,
            new Promise(r => setTimeout(() => r('timeout'), 3000)),
        ]);

        expect(result).not.toBe('timeout');
        expect(result.exitCode).toBe(1);

        // Give any potential restart a moment to happen
        await new Promise(r => setTimeout(r, 1200));

        expect((pm as any).processes.has('failing-task')).toBe(false);
    }, 6000);

    it('emits process:exit event on completion', async () => {
        app = new App({ name: 'OneshotEventTest', logger: { level: 'error' } });
        pm = new ProcessManager();
        app.register(pm);

        app.config.processes = {
            'event-task': {
                command: process.execPath,
                args: ['-e', 'process.exit(0)'],
                mode: 'oneshot',
            }
        };

        const events: any[] = [];
        app.on('process:exit', (ctx) => {
            events.push(ctx.payload);
        });

        await app.start();
        await new Promise(r => setTimeout(r, 2000));

        expect(events.length).toBe(1);
        expect(events[0].name).toBe('event-task');
    }, 5000);
});
