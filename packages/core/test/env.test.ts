import { afterEach, describe, expect, it } from 'bun:test';
import { App, isDevelopmentEnv, isProductionEnv, nodeEnv } from '../src/index';

const saved = process.env.NODE_ENV;
afterEach(() => {
    process.env.NODE_ENV = saved;
});

describe('environment helpers', () => {
    it('reads NODE_ENV when called', () => {
        process.env.NODE_ENV = 'staging';
        expect(nodeEnv()).toBe('staging');
        delete process.env.NODE_ENV;
        expect(nodeEnv()).toBeUndefined();
        process.env.NODE_ENV = '';
        expect(nodeEnv()).toBeUndefined();
    });

    it('applies development conveniences only to development and test', () => {
        expect(isDevelopmentEnv('development')).toBe(true);
        expect(isDevelopmentEnv('test')).toBe(true);
        for (const env of ['production', 'staging', 'prod', 'Development']) {
            expect(isDevelopmentEnv(env)).toBe(false);
            expect(isProductionEnv(env)).toBe(true);
        }
    });

    it('defaults to production safeguards when NODE_ENV is unset', () => {
        delete process.env.NODE_ENV;
        expect(isProductionEnv()).toBe(true);
        process.env.NODE_ENV = 'development';
        expect(isProductionEnv()).toBe(false);
    });
});

describe('App.start() without NODE_ENV', () => {
    async function warningsOnStart(): Promise<string[]> {
        const app = new App({ name: 'EnvTest', logger: { level: 'silent' }, shutdownSignals: false });
        const warnings: string[] = [];
        app.logger.warn = ((...args: unknown[]) => {
            warnings.push(args.map(String).join(' '));
        }) as typeof app.logger.warn;
        await app.start();
        await app.stop();
        return warnings;
    }

    it('warns that production defaults apply', async () => {
        delete process.env.NODE_ENV;
        const warnings = await warningsOnStart();
        expect(warnings.some((w) => w.includes('NODE_ENV is not set'))).toBe(true);
    });

    it('does not warn when NODE_ENV is set', async () => {
        process.env.NODE_ENV = 'test';
        expect((await warningsOnStart()).some((w) => w.includes('NODE_ENV'))).toBe(false);
    });
});
