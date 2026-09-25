import { describe, it, expect, spyOn } from 'bun:test';
import { App } from '@iskra-bun/core';
import { Kernel } from '../src/kernel';
import { WebPlugin } from '../src/driver';
import { RateLimitFeature } from '../src/features/rate-limit';
import type { KernelLogger } from '../src/logging';

type Entry = [level: string, message: string, details?: unknown];

function recordingLogger(): { logger: KernelLogger; entries: Entry[] } {
    const entries: Entry[] = [];
    const at = (level: string) => (message: string, details?: unknown) => {
        entries.push(details === undefined ? [level, message] : [level, message, details]);
    };
    return { logger: { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') }, entries };
}

/** Runs `fn` with the console silenced and returns how many console calls it made. */
async function consoleCalls(fn: () => Promise<void>): Promise<number> {
    const spies = (['debug', 'log', 'info', 'warn', 'error'] as const).map((m) =>
        spyOn(console, m).mockImplementation(() => {}),
    );
    try {
        await fn();
        return spies.reduce((n, s) => n + s.mock.calls.length, 0);
    } finally {
        spies.forEach((s) => s.mockRestore());
    }
}

describe('Kernel logger', () => {
    it("sends the Kernel's and the features' messages to the configured logger, not the console", async () => {
        const { logger, entries } = recordingLogger();
        const calls = await consoleCalls(async () => {
            const kernel = new Kernel({ logger });
            kernel.registerFeature(new RateLimitFeature());
            await kernel.initialize();
            kernel.getApp().get('/boom', () => {
                throw new Error('kaboom');
            });
            expect((await kernel.getApp().request('/boom')).status).toBe(500);
            await kernel.shutdown();
        });

        expect(calls).toBe(0);
        const messages = entries.map(([level, message]) => `${level}: ${message}`);
        expect(messages).toContain('debug: Rate limit feature initialized');
        // A feature's warning at request time goes through the same logger
        // (app.request() has no socket, so rate-limit cannot see the client IP).
        expect(messages.some((m) => m.startsWith('warn: rate-limit: client IP unavailable'))).toBe(true);
        expect(messages.some((m) => m.startsWith('info: Web-Kit Kernel initialized'))).toBe(true);
        const unhandled = entries.find(([, message]) => message === 'Unhandled error');
        expect(unhandled?.[0]).toBe('error');
        expect((unhandled?.[2] as Error).message).toBe('kaboom');
    });

    it('writes nothing with logger: false', async () => {
        const calls = await consoleCalls(async () => {
            const kernel = new Kernel({ logger: false });
            kernel.registerFeature(new RateLimitFeature());
            await kernel.initialize();
            await kernel.shutdown();
        });
        expect(calls).toBe(0);
    });

    it("WebPlugin uses the App's logger, with errors as { err }", async () => {
        const app = new App({ name: 'LoggerTest', logger: { level: 'silent' } });
        const calls: Array<[string, object, string]> = [];
        const at = (level: string) => (obj: object, msg: string) => calls.push([level, obj, msg]);
        Object.assign(app.logger, { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') });

        const plugin = new WebPlugin({ features: [new RateLimitFeature()] });
        await plugin.init(app);
        const hono = plugin.getHonoApp();
        hono.get('/boom', () => {
            throw new Error('kaboom');
        });
        await hono.request('/boom');

        expect(calls.some(([level, , msg]) => level === 'debug' && msg === 'Rate limit feature initialized')).toBe(
            true,
        );
        const unhandled = calls.find(([, , msg]) => msg === 'Unhandled error');
        expect(unhandled?.[0]).toBe('error');
        expect((unhandled?.[1] as { err: Error }).err.message).toBe('kaboom');
    });

    it("keeps an explicit logger over the App's", async () => {
        const { logger, entries } = recordingLogger();
        const app = new App({ name: 'LoggerTest', logger: { level: 'silent' } });
        const plugin = new WebPlugin({ logger, features: [new RateLimitFeature()] });
        await plugin.init(app);
        expect(entries.some(([, message]) => message === 'Rate limit feature initialized')).toBe(true);
    });

    it('refuses a new logger after initialize()', async () => {
        const kernel = new Kernel({ logger: false });
        await kernel.initialize();
        expect(() => kernel.setLogger(recordingLogger().logger)).toThrow(/after initialization/);
    });
});
