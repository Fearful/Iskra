import { afterEach, describe, expect, it } from 'bun:test';
import { App } from '@iskra-bun/core';
import { KVManager } from '../src';

describe('KVManager configuration', () => {
    it('refuses store options in the constructor (the old README example)', () => {
        // `adapter: 'redis'` was ignored: the app silently ran on memory.
        expect(() => new KVManager({ adapter: 'redis' } as never)).toThrow(/App config/);
        expect(() => new KVManager({ driver: 'redis', connection: 'redis://x' } as never)).toThrow(
            /"driver", "connection"/,
        );
        expect(() => new KVManager({ namespace: 'n' })).not.toThrow();
    });

    describe('without a kv driver', () => {
        const saved = process.env.NODE_ENV;
        afterEach(() => {
            process.env.NODE_ENV = saved;
        });

        function warningsOnInit(kv?: { driver: 'memory' }): string[] {
            const app = new App({ name: 'KvTest', logger: { level: 'silent' }, ...(kv && { kv }) });
            const warnings: string[] = [];
            app.logger.warn = ((...args: unknown[]) => {
                warnings.push(args.map(String).join(' '));
            }) as typeof app.logger.warn;
            new KVManager().init(app);
            return warnings;
        }

        it('warns in production that the memory store is per process', () => {
            delete process.env.NODE_ENV;
            expect(warningsOnInit().some((w) => w.includes('in-memory store'))).toBe(true);
        });

        it('does not warn in development, or when memory is chosen explicitly', () => {
            process.env.NODE_ENV = 'development';
            expect(warningsOnInit()).toEqual([]);
            delete process.env.NODE_ENV;
            expect(warningsOnInit({ driver: 'memory' })).toEqual([]);
        });
    });
});
