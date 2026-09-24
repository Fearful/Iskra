import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { App } from '@iskra-bun/core';
import { ProcessManager } from '../src/spawner';

/** Running and not a zombie (a killed child reparented to PID 1 may linger unreaped). */
function running(pid: number): boolean {
    try {
        return !/\) Z /.test(readFileSync(`/proc/${pid}/stat`, 'utf8'));
    } catch {
        return false;
    }
}

function setup() {
    const app = new App({ name: 'Supervision', logger: { level: 'silent' } });
    const pm = new ProcessManager();
    pm.init(app);
    const exits: any[] = [];
    const logs: string[] = [];
    const errors: string[] = [];
    app.on('process:exit', (ctx) => { exits.push(ctx.payload); });
    app.on('process:log', (ctx) => { logs.push(ctx.payload.text); });
    app.on('process:error', (ctx) => { errors.push(ctx.payload.text); });
    return { app, pm, exits, logs, errors };
}

async function until(cond: () => boolean, ms = 3000) {
    const end = Date.now() + ms;
    while (!cond()) {
        if (Date.now() > end) throw new Error('condition not met in time');
        await Bun.sleep(20);
    }
}

describe.if(process.platform === 'linux')('ProcessManager supervision', () => {
    it('kill() terminates grandchildren of a wrapper script (process group)', async () => {
        // Regression: only the direct PID was signalled; `sh -c`/`npm run`
        // style wrappers left their children running.
        const { pm, logs } = setup();
        await pm.spawn('wrapper', { command: 'bash', args: ['-c', 'sleep 300 & echo "pid=$!" ; wait'], mode: 'stdio' });
        await until(() => logs.length > 0);
        const grandchild = Number(logs[0].replace('pid=', ''));
        expect(running(grandchild)).toBe(true);

        await pm.kill('wrapper', 1000);
        await until(() => !running(grandchild), 2000);
    });

    it('does not restart after a clean exit (code 0)', async () => {
        const { pm, exits } = setup();
        await pm.spawn('clean', { command: 'true', mode: 'daemon', restartOnCrash: true, restartBackoff: { initialMs: 20 } });
        await until(() => exits.length === 1);
        await Bun.sleep(150);
        expect(exits).toEqual([{ name: 'clean', exitCode: 0, signal: null }]);
        await pm.stop(200);
    });

    it('reports signal deaths as crashes (exitCode null + signal) and restarts them', async () => {
        const { pm, exits } = setup();
        await pm.spawn('victim', { command: 'sleep', args: ['300'], mode: 'daemon', restartOnCrash: true, restartBackoff: { initialMs: 20 } });
        const first = (pm as any).processes.get('victim').process;
        process.kill(first.pid, 'SIGKILL');
        await until(() => exits.length === 1);
        expect(exits[0]).toEqual({ name: 'victim', exitCode: null, signal: 'SIGKILL' });
        await until(() => (pm as any).processes.get('victim')?.process !== undefined && (pm as any).processes.get('victim').process !== first);
        await pm.stop(200);
    });

    it('kill() during the restart backoff cancels the pending restart', async () => {
        // Regression: kill() threw "not found" and the untracked timer respawned it.
        const { pm, exits } = setup();
        await pm.spawn('crashy', { command: 'false', mode: 'daemon', restartOnCrash: true, restartBackoff: { initialMs: 200 } });
        await until(() => exits.length === 1);

        await pm.kill('crashy'); // no throw
        await Bun.sleep(350);
        expect((pm as any).processes.has('crashy')).toBe(false);
        expect(exits).toHaveLength(1);
    });

    it('ignores a late exit from an older instance with the same name', async () => {
        const { pm } = setup();
        await pm.spawn('svc', { command: 'sleep', args: ['300'], mode: 'daemon', restartOnCrash: true });
        const current = (pm as any).processes.get('svc');
        const olderInstance = { pid: -1 };
        (pm as any).handleExit('svc', 1, null, olderInstance);
        expect((pm as any).processes.get('svc')).toBe(current);
        await pm.stop(200);
    });

    it('can be started again after stop()', async () => {
        // Regression: `stopping` was never reset, so start() after stop() spawned nothing.
        const app = new App({ name: 'Restartable', logger: { level: 'silent' }, processes: { s: { command: 'sleep', args: ['300'] } } } as any);
        const pm = new ProcessManager();
        pm.init(app);
        await pm.start();
        await pm.stop(200);
        await pm.start();
        expect((pm as any).processes.has('s')).toBe(true);
        await pm.stop(200);
    });

    it('emits whole lines, including a final line without a newline', async () => {
        const { pm, logs, errors, exits } = setup();
        await pm.spawn('printer', {
            command: 'bash',
            args: ['-c', 'printf "one\\ntwo" ; printf "e1\\ne2\\ne3" >&2'],
            mode: 'stdio',
        });
        await until(() => exits.length === 1);
        await Bun.sleep(50);
        expect(logs).toEqual(['one', 'two']);
        expect(errors).toEqual(['e1', 'e2', 'e3']);
    });
});
