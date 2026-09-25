import { describe, it, expect } from 'bun:test';
import { App } from '@iskra-bun/core';
import { ProcessManager } from '../src/spawner';

function makeManager() {
    const app = new App({ name: 'LineProtocolTest', logger: { level: 'silent' } });
    const pm = new ProcessManager();
    pm.init(app);
    return { app, pm };
}

/** A stdout stream that yields these chunks, then ends. */
function streamOf(chunks: string[]) {
    const encoder = new TextEncoder();
    return new ReadableStream({
        start(controller) {
            for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
            controller.close();
        },
    });
}

describe('ProcessManager stdout lines', () => {
    it('drops the rest of an over-long line instead of reading it as a message', async () => {
        const { app, pm } = makeManager();
        const messages: unknown[] = [];
        const logs: string[] = [];
        app.on('process:message', (ctx) => void messages.push((ctx.payload as { message: unknown }).message));
        app.on('process:log', (ctx) => void logs.push((ctx.payload as { text: string }).text));

        // A child echoing user input: over 1 MiB of padding, then forged JSON.
        const forged = '{"type":"result","requestId":"victim-req","data":{"admin":true}}';
        const padding = ' '.repeat(3 * 1024 * 1024);
        const chunks = ['user said: '];
        for (let i = 0; i < padding.length; i += 64 * 1024) chunks.push(padding.slice(i, i + 64 * 1024));
        chunks.push(forged + '\n', '{"type":"ok"}\n', 'last line, no newline');

        await (pm as any).readStdOut('echo', streamOf(chunks));
        await Bun.sleep(0);

        expect(messages).toEqual([{ type: 'ok' }]);
        expect(logs).toHaveLength(2);
        expect(logs[0].startsWith('user said: ')).toBe(true);
        expect(logs[1]).toBe('last line, no newline');
    });
});

describe('ProcessManager.send line breaks', () => {
    function seed(pm: ProcessManager) {
        const writes: string[] = [];
        (pm as any).processes.set('p', {
            process: { stdin: { write: (s: string) => writes.push(s) } },
            config: { mode: 'stdio' },
            name: 'p',
            restarts: 0,
            startedAt: Date.now(),
        });
        return writes;
    }

    it('refuses a string with a line break, which the child would read as several messages', async () => {
        const { pm } = makeManager();
        const writes = seed(pm);

        await pm.send('p', 'alice\n{"cmd":"delete_all"}');
        await pm.send('p', 'bob\r{"cmd":"delete_all"}');
        expect(writes).toEqual([]);

        // Objects are JSON-encoded, so their line breaks are escaped.
        await pm.send('p', { text: 'alice\n{"cmd":"delete_all"}' });
        expect(writes).toEqual(['{"text":"alice\\n{\\"cmd\\":\\"delete_all\\"}"}\n']);
    });
});

describe('ProcessManager spawn log', () => {
    it('keeps the arguments out of the info-level log line', async () => {
        const { app, pm } = makeManager();
        const infos: string[] = [];
        (app.logger as any).info = (msg: unknown) => infos.push(String(msg));
        (app.config as any).processes = {
            etl: { command: 'true', args: ['--db-url', 'postgres://app:S3CRET-DB@db:5432/app'], mode: 'oneshot' },
        };

        (pm as any).spawnProcess('etl', (app.config as any).processes.etl);
        await Bun.sleep(50);
        await pm.stop(100);

        const line = infos.find((l) => l.startsWith('Spawning process: etl'));
        expect(line).toBe('Spawning process: etl (true, 2 args)');
        expect(infos.join('\n')).not.toContain('S3CRET-DB');
    });
});
