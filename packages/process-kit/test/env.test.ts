import { describe, it, expect, afterAll } from 'bun:test';
import { App } from '@iskra-bun/core';
import { ProcessManager } from '../src/spawner';

// Real children that print their environment: what they inherit is the point.
const SECRET = 'ISKRA_ENV_TEST_SECRET';
process.env[SECRET] = 'postgres://app:S3CRET@db/app';

afterAll(() => {
    delete process.env[SECRET];
});

/** The environment a stdio child started with `config` sees. */
async function envOfChild(config: Record<string, unknown>): Promise<Record<string, string>> {
    const app = new App({ name: 'EnvTest', logger: { level: 'silent' }, shutdownSignals: false });
    const pm = new ProcessManager();
    app.register(pm);
    await app.start();
    try {
        const printed = new Promise<Record<string, string>>((resolve) => {
            app.on('process:message', (ctx) => resolve(ctx.payload.message as Record<string, string>));
        });
        await pm.spawn('env', {
            command: process.execPath,
            args: ['-e', 'console.log(JSON.stringify(process.env))'],
            mode: 'stdio',
            ...config,
        });
        return await printed;
    } finally {
        await app.stop();
    }
}

describe('child environment', () => {
    it('does not pass the app secrets by default', async () => {
        const env = await envOfChild({ env: { EXTRA: '1' } });

        expect(env[SECRET]).toBeUndefined();
        // What programs need to run still gets there, and so does `env`.
        expect(env.PATH).toBe(process.env.PATH!);
        if (process.env.HOME) expect(env.HOME).toBe(process.env.HOME);
        expect(env.EXTRA).toBe('1');
    });

    it('adds the names listed in inheritEnv to that minimal set', async () => {
        const env = await envOfChild({ inheritEnv: [SECRET] });

        expect(env[SECRET]).toBe(process.env[SECRET]!);
        expect(env.PATH).toBe(process.env.PATH!);
    });

    it('passes the whole environment with inheritEnv: true', async () => {
        const env = await envOfChild({ inheritEnv: true, env: { EXTRA: '1' } });

        expect(env[SECRET]).toBe(process.env[SECRET]!);
        expect(env.EXTRA).toBe('1');
    });
});
