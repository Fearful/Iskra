import { describe, it, expect, afterEach } from 'bun:test';
import { App } from '@iskra-bun/core';
import { KVManager } from '../src';
import { MemoryAdapter } from '../src/adapters/memory';
import { RedisAdapter } from '../src/adapters/redis';

describe('MemoryAdapter TTLs', () => {
    let adapter: MemoryAdapter;
    afterEach(() => adapter.disconnect());

    it('keeps a key whose TTL exceeds setTimeout\'s ~24.8-day limit', async () => {
        adapter = new MemoryAdapter();
        await adapter.set('session', { user: 1 }, 30 * 24 * 3600);
        await Bun.sleep(20);
        // The overflowed timer used to fire at once.
        expect(await adapter.get('session')).toEqual({ user: 1 });
    });

    it('rejects a negative or non-finite TTL instead of deleting the key at once', async () => {
        adapter = new MemoryAdapter();
        await adapter.set('k', 'kept');
        for (const ttl of [-5, Number.NaN, Number.POSITIVE_INFINITY]) {
            await expect(adapter.set('k', 'lost', ttl)).rejects.toThrow(RangeError);
        }
        expect(await adapter.get('k')).toBe('kept');
    });

    it('treats a TTL of 0 as no expiry', async () => {
        adapter = new MemoryAdapter();
        await adapter.set('k', 1, 0);
        await Bun.sleep(5);
        expect(await adapter.get('k')).toBe(1);
    });
});

describe('RedisAdapter', () => {
    it('rejects a negative TTL before sending anything', async () => {
        const adapter = new RedisAdapter({});
        const sent: unknown[] = [];
        (adapter as any).client = { set: async (...args: unknown[]) => sent.push(args), pipeline: () => ({}) };
        await expect(adapter.set('k', 1, -1)).rejects.toThrow(RangeError);
        await expect(adapter.mset([['k', 1]], -1)).rejects.toThrow(RangeError);
        expect(sent).toEqual([]);
    });

    it('fails the app start when Redis is unreachable, without leaking the password', async () => {
        const errors: unknown[] = [];
        const app = new App({
            name: 'KvUnreachable',
            logger: { level: 'silent' },
            kv: { driver: 'redis', connection: { url: 'redis://:s3cret@127.0.0.1:1', maxRetriesPerRequest: 0 } },
        } as any);
        (app.logger as any).warn = (obj: unknown) => errors.push(obj);
        app.register(new KVManager());

        const error = await app.start().then(() => undefined, (e: unknown) => e);
        // start() used to resolve and the first command failed (or hung) later.
        expect(error).toBeDefined();
        expect(String((error as Error).message)).not.toContain('s3cret');
        expect(JSON.stringify(error)).not.toContain('s3cret');
    });
});
