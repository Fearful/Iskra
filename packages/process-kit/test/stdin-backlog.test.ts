import { describe, it, expect, afterAll } from 'bun:test';
import { App } from '@iskra-bun/core';
import { readFileSync } from 'node:fs';
import { ProcessManager } from '../src/spawner';

// Real pipes: what matters is what Bun keeps in memory once a child stops
// reading its stdin, which a fake FileSink would not show.
const posix = process.platform !== 'win32';
const CHUNK = { pad: 'x'.repeat(64 * 1024) };
const CHUNK_BYTES = JSON.stringify(CHUNK).length + 1;

afterAll(() => {
    Bun.spawnSync(['pkill', '-9', '-f', '^sleep 78[0-9][0-9]']);
});

function makeManager() {
    const app = new App({ name: 'StdinBacklog', logger: { level: 'silent' }, shutdownSignals: false });
    const pm = new ProcessManager();
    app.register(pm);
    return { app, pm };
}

/** Most a pipe can hold on this system (Bun may grow it up to this). */
function pipeCapacity(): number {
    try {
        return Number(readFileSync('/proc/sys/fs/pipe-max-size', 'utf8')) || 1024 * 1024;
    } catch {
        return 1024 * 1024;
    }
}

async function waitFor(condition: () => boolean, ms = 3000) {
    const deadline = Date.now() + ms;
    while (!condition() && Date.now() < deadline) await Bun.sleep(20);
    return condition();
}

describe.if(posix)('send() to a child that does not read its stdin', () => {
    it('refuses messages past maxPendingStdinBytes instead of buffering them all', async () => {
        const { app, pm } = makeManager();
        const warnings: string[] = [];
        (app.logger as any).warn = (msg: unknown) => warnings.push(String(msg));
        await app.start();
        const max = 256 * 1024;
        await pm.spawn('deaf', { command: 'sleep', args: ['7801'], mode: 'stdio', maxPendingStdinBytes: max });

        Bun.gc(true);
        const rss = process.memoryUsage().rss;
        // 64 MiB offered: all of it used to be held for a child that never
        // reads (RSS grew by ~155 MiB).
        const results: unknown[] = [];
        for (let i = 0; i < 1024; i++) results.push(await pm.send('deaf', CHUNK));
        Bun.gc(true);

        expect(process.memoryUsage().rss - rss).toBeLessThan(40 * 1024 * 1024);
        expect(results).toContain(false);
        // Only what the pipe holds, plus the backlog allowed, was taken.
        const accepted = results.filter((r) => r === true).length;
        expect(accepted * CHUNK_BYTES).toBeLessThanOrEqual(pipeCapacity() + max + CHUNK_BYTES);
        expect((pm as any).processes.get('deaf').pendingStdinBytes).toBeLessThanOrEqual(max);
        expect(warnings.filter((w) => w.includes('still waiting to be read'))).toHaveLength(1);
        await app.stop();
    });

    it('accepts messages again once the child has read what was waiting', async () => {
        const { app, pm } = makeManager();
        await app.start();
        await pm.spawn('slow', {
            command: 'sh',
            args: ['-c', 'sleep 0.5; exec cat > /dev/null'],
            mode: 'stdio',
            maxPendingStdinBytes: 128 * 1024,
        });

        let refused = false;
        for (let i = 0; i < 100 && !refused; i++) refused = !(await pm.send('slow', CHUNK));
        expect(refused).toBe(true);

        const info = (pm as any).processes.get('slow');
        expect(await waitFor(() => info.pendingStdinBytes === 0)).toBe(true);
        expect(await pm.send('slow', CHUNK)).toBe(true);
        await app.stop();
    });

    it('still takes a message larger than the limit when nothing is waiting', async () => {
        const { app, pm } = makeManager();
        await app.start();
        await pm.spawn('reader', { command: 'cat', mode: 'stdio', maxPendingStdinBytes: 1024 });

        expect(await pm.send('reader', CHUNK)).toBe(true);
        await app.stop();
    });
});
