import { describe, it, expect, afterEach } from 'bun:test';
import { App } from '@iskra-bun/core';
import { ProcessManager } from '../src/spawner';

describe('ProcessManager.spawn / kill – runtime process management', () => {
    let app: App;
    let pm: ProcessManager;

    afterEach(async () => {
        try { await pm?.stop(500); } catch { /* already stopped */ }
        try { await app?.stop(); } catch { /* already stopped */ }
    });

    it('spawn() adds a new process to the map at runtime', async () => {
        app = new App({ name: 'SpawnTest', logger: { level: 'error' } });
        pm = new ProcessManager();
        app.register(pm);
        await app.start(); // starts with no processes configured

        expect((pm as any).processes.size).toBe(0);

        await pm.spawn('sleeper', {
            command: 'sleep',
            args: ['10'],
            mode: 'daemon',
        });

        expect((pm as any).processes.has('sleeper')).toBe(true);
        expect((pm as any).processes.size).toBe(1);
    });

    it('spawn() rejects duplicate names with a clear error', async () => {
        app = new App({ name: 'SpawnDupTest', logger: { level: 'error' } });
        pm = new ProcessManager();
        app.register(pm);
        await app.start();

        await pm.spawn('dup', { command: 'sleep', args: ['10'], mode: 'daemon' });

        await expect(
            pm.spawn('dup', { command: 'sleep', args: ['10'], mode: 'daemon' })
        ).rejects.toThrow("Process 'dup' is already registered");
    });

    it('kill() removes the process from the map and terminates it', async () => {
        app = new App({ name: 'KillTest', logger: { level: 'error' } });
        pm = new ProcessManager();
        app.register(pm);
        await app.start();

        await pm.spawn('target', {
            command: 'sleep',
            args: ['30'],
            mode: 'daemon',
        });

        expect((pm as any).processes.has('target')).toBe(true);

        await pm.kill('target', 2000);

        expect((pm as any).processes.has('target')).toBe(false);
    }, 8000);

    it('kill() actually terminates the subprocess (process.killed is true)', async () => {
        app = new App({ name: 'KillTerminateTest', logger: { level: 'error' } });
        pm = new ProcessManager();
        app.register(pm);
        await app.start();

        await pm.spawn('victim', { command: 'sleep', args: ['30'], mode: 'daemon' });

        // Capture the underlying Bun.Subprocess before kill() removes it from the map
        const subproc = (pm as any).processes.get('victim').process;

        await pm.kill('victim', 2000);

        expect(subproc.killed).toBe(true);
    }, 8000);

    it('kill() rejects with a clear error when the process does not exist', async () => {
        app = new App({ name: 'KillUnknownTest', logger: { level: 'error' } });
        pm = new ProcessManager();
        app.register(pm);
        await app.start();

        await expect(pm.kill('ghost', 500)).rejects.toThrow("Process 'ghost' not found");
    });

    it('spawn() then kill() round-trip: process enters then leaves the map', async () => {
        app = new App({ name: 'RoundTripTest', logger: { level: 'error' } });
        pm = new ProcessManager();
        app.register(pm);
        await app.start();

        expect((pm as any).processes.has('short')).toBe(false);

        await pm.spawn('short', {
            command: process.execPath,
            args: ['-e', 'setInterval(() => {}, 60000)'], // runs until killed
            mode: 'daemon',
        });

        expect((pm as any).processes.has('short')).toBe(true);

        await pm.kill('short', 2000);

        expect((pm as any).processes.has('short')).toBe(false);
    }, 8000);
});
