import { describe, it, expect } from 'bun:test';
import { join } from 'node:path';
import { App } from '@iskra-bun/core';
import { createProcessor, PROCESS_NAME, type ProcessorOptions } from '../src/processor.ts';

/** The processor over a fake ProcessManager: `sent` is what reached Python. */
function setup(options: ProcessorOptions = {}) {
    const app = new App({ name: 'ProcessorTest', logger: { level: 'silent' }, shutdownSignals: false });
    const sent: Record<string, unknown>[] = [];
    const processor = createProcessor(
        app,
        { send: (_name, data) => sent.push(data as Record<string, unknown>) },
        options,
    );
    const fromPython = (message: unknown) => app.emit('process:message', { name: PROCESS_NAME, message });
    fromPython({ type: 'status', msg: 'Python processor started' });
    const post = (body: string, type = 'application/json') =>
        processor.router.request('/process', { method: 'POST', headers: { 'Content-Type': type }, body });
    return { app, sent, processor, fromPython, post };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('python-data-processor /process', () => {
    it('answers with what Python replies', async () => {
        const { sent, fromPython, post } = setup();
        const response = post(JSON.stringify({ data: [1, 2, 3] }));
        await tick();
        // Each request carries its id and a deadline Python checks before working on it.
        const { requestId, deadline, ...data } = sent[0];
        expect(data).toEqual({ data: [1, 2, 3] });
        expect(typeof requestId).toBe('string');
        expect(deadline).toBeGreaterThan(Date.now());
        fromPython({ type: 'result', requestId: sent[0].requestId, data: { ok: true } });
        const res = await response;
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ success: true, result: { ok: true } });
    });

    it('accepts only JSON objects', async () => {
        const { sent, post } = setup();
        // Any Content-Type used to be parsed as JSON.
        expect((await post('{"data":1}', 'text/plain')).status).toBe(415);
        expect((await post('[1,2]')).status).toBe(400);
        expect((await post('{nope')).status).toBe(400);
        expect(sent).toEqual([]);
    });

    it('refuses requests beyond the in-flight cap', async () => {
        const { sent, post } = setup({ maxInFlight: 2 });
        void post('{}');
        void post('{}');
        await tick();
        const third = await post('{}');
        expect(third.status).toBe(503);
        expect(third.headers.get('retry-after')).toBe('1');
        expect(sent).toHaveLength(2);
    });

    it('keeps a timed-out request counted until Python answers it', async () => {
        const { sent, fromPython, post, processor } = setup({ maxInFlight: 1, timeoutMs: 20 });
        expect((await post('{}')).status).toBe(504);
        // Python still has it queued: no room for another one yet.
        expect((await post('{}')).status).toBe(503);
        expect(processor.inFlight()).toBe(1);

        fromPython({ type: 'error', requestId: sent[0].requestId, msg: 'expired' });
        await tick();
        expect(processor.inFlight()).toBe(0);
        const next = post('{}');
        await tick();
        fromPython({ type: 'result', requestId: sent[1].requestId, data: 'ok' });
        expect((await next).status).toBe(200);
    });

    it('fails pending requests at once when Python exits, and waits for it to be back', async () => {
        const { app, fromPython, post, processor } = setup({ timeoutMs: 60_000 });
        const pending = post('{}');
        await tick();
        app.emit('process:exit', { name: PROCESS_NAME, exitCode: 1, signal: null });
        const res = await pending;
        expect(res.status).toBe(503);
        expect(processor.inFlight()).toBe(0);

        expect((await post('{}')).status).toBe(503);
        fromPython({ type: 'status', msg: 'Python processor started' });
        await tick();
        void post('{}');
        await tick();
        expect(processor.inFlight()).toBe(1);
    });

    it('does not echo the Python exception to the client', async () => {
        const { sent, fromPython, post } = setup();
        const response = post('{}');
        await tick();
        fromPython({ type: 'error', requestId: sent[0].requestId, msg: "No such file: '/srv/secret/config.yml'" });
        const res = await response;
        expect(res.status).toBe(502);
        expect(JSON.stringify(await res.json())).not.toContain('/srv/secret');
    });
});

describe.if(Bun.which('python3') !== null)('process.py', () => {
    it('skips expired requests and answers them with their requestId', async () => {
        const proc = Bun.spawn(['python3', join(import.meta.dir, '..', 'src', 'scripts', 'process.py')], {
            stdin: 'pipe',
            stdout: 'pipe',
        });
        const started = Date.now();
        proc.stdin.write(JSON.stringify({ requestId: 'r-1', deadline: Date.now() - 1, data: 1 }) + '\n');
        proc.stdin.end();
        const lines = (await new Response(proc.stdout).text())
            .trim()
            .split('\n')
            .map((l) => JSON.parse(l));
        expect(lines[0]).toMatchObject({ type: 'status' });
        expect(lines[1]).toEqual({ type: 'error', msg: 'expired', requestId: 'r-1' });
        // process_data sleeps 500 ms: the expired request never got there.
        expect(Date.now() - started).toBeLessThan(450);
    });
});
