import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { ProcessManager } from '../src/spawner';
import { App } from '@iskra-bun/core';

describe('ProcessManager', () => {
    let app: App;
    let manager: ProcessManager;

    beforeAll(async () => {
        app = new App({ name: 'ProcTest' });
        manager = new ProcessManager();
        app.register(manager);
        // We initialize but don't start yet, or we start with no processes
        await app.init();
    });

    afterAll(async () => {
        await app.stop();
    });

    it('should spawn a process and capture stdout', async () => {
        // Setup config specifically for this test
        app.config.processes = {
            'echo-test': {
                command: 'echo',
                args: ['hello world'],
                mode: 'stdio',
            },
        };

        const listPromise = new Promise((resolve) => {
            app.on('process:log', (ctx) => {
                if (ctx.payload.text.includes('hello world')) {
                    resolve(true);
                }
            });
        });

        await manager.start();
        await listPromise;
    });

    it('should parse JSON output as process:message', async () => {
        // Using bun -e to print JSON
        app.config.processes = {
            'json-test': {
                command: process.execPath,
                args: ['-e', 'console.log(JSON.stringify({foo: "bar"}))'],
                mode: 'stdio',
            },
        };

        const jsonPromise = new Promise((resolve) => {
            app.on('process:message', (ctx) => {
                if (ctx.payload.name === 'json-test') {
                    expect(ctx.payload.message).toEqual({ foo: 'bar' });
                    resolve(true);
                }
            });
        });

        await manager.start();
        await jsonPromise;
    });
});
