import { describe, it, expect, beforeEach } from 'bun:test';
import { App } from '@iskra-bun/core';
import { ProcessManager } from '../src/spawner';

// White-box tests for ProcessManager.send: the branches below are awkward to
// reach through real subprocesses, so we seed the private process map with a
// fake stdio target and assert what gets written.
function makeManager() {
    const app = new App({ name: 'SendTest', logger: { level: 'error' } });
    const pm = new ProcessManager();
    pm.init(app);
    return pm;
}

function seedStdioProcess(pm: ProcessManager, name: string, stdin: any) {
    (pm as any).processes.set(name, {
        process: { stdin },
        config: { mode: 'stdio' },
        name,
        restarts: 0,
        startedAt: Date.now(),
    });
}

describe('ProcessManager.send', () => {
    let pm: ProcessManager;
    beforeEach(() => {
        pm = makeManager();
    });

    it('no-ops when the target process does not exist', async () => {
        await pm.send('ghost', 'hello'); // should warn and return without throwing
    });

    it('no-ops when the target process is not in stdio mode', async () => {
        (pm as any).processes.set('daemon', {
            process: {},
            config: { mode: 'daemon' },
            name: 'daemon',
            restarts: 0,
            startedAt: Date.now(),
        });
        await pm.send('daemon', 'hello');
    });

    it('writes a string message to stdin verbatim with a newline', async () => {
        const writes: string[] = [];
        let flushed = false;
        seedStdioProcess(pm, 'p', {
            write: (s: string) => writes.push(s),
            flush: () => {
                flushed = true;
            },
        });

        await pm.send('p', 'hello');

        expect(writes).toEqual(['hello\n']);
        expect(flushed).toBe(true);
    });

    it('serializes object messages to JSON before writing', async () => {
        const writes: string[] = [];
        seedStdioProcess(pm, 'p', { write: (s: string) => writes.push(s), flush: () => {} });

        await pm.send('p', { foo: 'bar' });

        expect(writes).toEqual(['{"foo":"bar"}\n']);
    });

    it('swallows and logs errors thrown while writing to stdin', async () => {
        seedStdioProcess(pm, 'p', {
            write: () => {
                throw new Error('pipe broken');
            },
            flush: () => {},
        });

        await pm.send('p', 'boom'); // caught internally; must not throw
    });
});
