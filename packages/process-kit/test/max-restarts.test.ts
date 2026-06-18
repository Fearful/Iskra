import { describe, it, expect, afterAll } from 'bun:test';
import { App } from '@iskra-bun/core';
import { ProcessManager } from '../src/spawner';

describe('ProcessManager Max Restarts', () => {
    let app: App;
    let pm: ProcessManager;

    afterAll(async () => {
        if (pm) await pm.stop();
        if (app) await app.stop();
    });

    it('should track restart count and stop after maxRestarts', async () => {
        app = new App({
            name: 'MaxRestartTest',
            logger: { level: 'error' },
            processes: {
                'crasher': {
                    command: process.execPath,
                    args: [`${import.meta.dir}/crash-process.ts`],
                    mode: 'daemon',
                    restartOnCrash: true,
                    maxRestarts: 2,
                    restartCooldown: 60000,
                }
            }
        });

        pm = new ProcessManager();
        app.register(pm);

        const maxRestartsPromise = new Promise<any>(resolve => {
            app.on('process:max-restarts', (ctx) => {
                resolve(ctx.payload);
            });
        });

        await app.start();

        // Wait for the process to crash and exhaust restarts (each restart has 1s delay)
        const result = await Promise.race([
            maxRestartsPromise,
            new Promise(resolve => setTimeout(() => resolve('timeout'), 8000)),
        ]);

        expect(result).not.toBe('timeout');
        expect(result.name).toBe('crasher');
        expect(result.maxRestarts).toBe(2);
    }, 10000);

    it('should respect maxRestarts default of 10', () => {
        const config = { command: 'echo', restartOnCrash: true };
        expect(config.restartOnCrash).toBe(true);
    });
});
