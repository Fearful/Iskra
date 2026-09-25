import { describe, it, expect, afterAll } from 'bun:test';
import { App } from '@iskra-bun/core';
import { ProcessManager } from '../src/spawner';

describe('Process Manager', () => {
    let app: App;
    let pm: ProcessManager;

    it('should communicate with process', async () => {
        // mock app config
        const config = {
            name: 'ProcessTest',
            logger: { level: 'error' },
            processes: {
                mock: {
                    command: process.execPath,
                    args: [`${import.meta.dir}/mock-process.ts`],
                    mode: 'stdio',
                },
            },
        };

        app = new App(config as any);
        pm = new ProcessManager();
        app.register(pm);

        const receivedMessages: any[] = [];
        const receivedErrors: any[] = [];

        app.on('process:message', (ctx) => {
            receivedMessages.push(ctx.payload.message);
        });

        app.on('process:error', (ctx) => {
            receivedErrors.push(ctx.payload.text);
        });

        await app.start();

        // Wait for started message
        await new Promise((r) => setTimeout(r, 1000));

        const startedMsg = receivedMessages.find((m) => m.status === 'started');
        expect(startedMsg).toBeDefined();

        // Send normal message
        await pm.send('mock', 'hello');

        // Wait for response
        await new Promise((r) => setTimeout(r, 500));
        const responseMsg = receivedMessages.find((m) => m.received === 'hello');
        expect(responseMsg).toBeDefined();

        // Send error trigger
        await pm.send('mock', 'error');

        // Wait for error
        await new Promise((r) => setTimeout(r, 500));
        const errorMsg = receivedErrors.find((e) => e && e.includes('This is an error'));
        expect(errorMsg).toBeDefined();
    });

    afterAll(async () => {
        if (pm) await pm.stop();
        if (app) await app.stop();
    });
});
