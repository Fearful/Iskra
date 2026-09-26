import { describe, expect, it } from 'bun:test';
import { Kernel } from '../src/kernel';
import { CacheFeature } from '../src/features/cache';

describe('Cache Feature', () => {
    it('shuts down without having been initialized', async () => {
        await expect(new CacheFeature().shutdown()).resolves.toBeUndefined();
    });

    it('should init with memory adapter by default', async () => {
        const kernel = new Kernel();
        const cache = new CacheFeature();
        kernel.registerFeature(cache);
        await kernel.initialize();

        expect(cache.client).toBeDefined();

        await cache.client.set('key1', 'value1');
        const val = await cache.client.get('key1');
        expect(val).toBe('value1');

        await kernel.shutdown();
    });

    it('should set and get complex objects', async () => {
        const kernel = new Kernel();
        const cache = new CacheFeature({ adapter: 'memory' });
        kernel.registerFeature(cache);
        await kernel.initialize();

        const obj = { name: 'test', nested: { a: 1 } };
        await cache.client.set('obj', obj);
        const val = await cache.client.get('obj');
        expect(val).toEqual(obj);

        await kernel.shutdown();
    });

    it('should respect TTL on memory adapter', async () => {
        const kernel = new Kernel();
        const cache = new CacheFeature({ adapter: 'memory' });
        kernel.registerFeature(cache);
        await kernel.initialize();

        await cache.client.set('ttl-key', 'temp', 0.1); // 100ms
        expect(await cache.client.get('ttl-key')).toBe('temp');

        await new Promise((r) => setTimeout(r, 150));
        expect(await cache.client.get('ttl-key')).toBeNull();

        await kernel.shutdown();
    });

    it('should delete keys', async () => {
        const kernel = new Kernel();
        const cache = new CacheFeature({ adapter: 'memory' });
        kernel.registerFeature(cache);
        await kernel.initialize();

        await cache.client.set('del-key', 'value');
        expect(await cache.client.get('del-key')).toBe('value');

        await cache.client.delete('del-key');
        expect(await cache.client.get('del-key')).toBeNull();

        await kernel.shutdown();
    });

    it('should check key existence', async () => {
        const kernel = new Kernel();
        const cache = new CacheFeature({ adapter: 'memory' });
        kernel.registerFeature(cache);
        await kernel.initialize();

        await cache.client.set('exists-key', 'yes');
        expect(await cache.client.exists('exists-key')).toBe(true);
        expect(await cache.client.exists('nope')).toBe(false);

        await kernel.shutdown();
    });

    it('should support increment on memory adapter', async () => {
        const kernel = new Kernel();
        const cache = new CacheFeature({ adapter: 'memory' });
        kernel.registerFeature(cache);
        await kernel.initialize();

        await cache.client.set('counter', 5);
        const result = await cache.client.increment!('counter');
        expect(result).toBe(6);

        const result2 = await cache.client.increment!('counter');
        expect(result2).toBe(7);

        await kernel.shutdown();
    });

    it('should return 0 for increment on nonexistent key', async () => {
        const kernel = new Kernel();
        const cache = new CacheFeature({ adapter: 'memory' });
        kernel.registerFeature(cache);
        await kernel.initialize();

        const result = await cache.client.increment!('no-such-key');
        expect(result).toBe(0);

        await kernel.shutdown();
    });

    it('should return null for nonexistent keys', async () => {
        const kernel = new Kernel();
        const cache = new CacheFeature({ adapter: 'memory' });
        kernel.registerFeature(cache);
        await kernel.initialize();

        const val = await cache.client.get('nonexistent');
        expect(val).toBeNull();

        await kernel.shutdown();
    });

    it('incrementWithTtl creates the counter with an expiry and resets after it', async () => {
        const kernel = new Kernel();
        const cache = new CacheFeature({ adapter: 'memory' });
        kernel.registerFeature(cache);
        await kernel.initialize();

        expect(await cache.client.incrementWithTtl!('rl', 50)).toBe(1);
        expect(await cache.client.incrementWithTtl!('rl', 50)).toBe(2);
        await new Promise((r) => setTimeout(r, 80));
        expect(await cache.client.incrementWithTtl!('rl', 50)).toBe(1);

        await kernel.shutdown();
    });

    it('returns 0 when incrementing an expired key', async () => {
        const kernel = new Kernel();
        const cache = new CacheFeature({ adapter: 'memory' });
        kernel.registerFeature(cache);
        await kernel.initialize();

        await cache.client.set('expiring', 10, 0.05); // 50ms TTL
        await new Promise((r) => setTimeout(r, 80));
        expect(await cache.client.increment!('expiring')).toBe(0);

        await kernel.shutdown();
    });

    it('exposes the cache adapter on the request context', async () => {
        const kernel = new Kernel();
        kernel.registerFeature(new CacheFeature({ adapter: 'memory' }));
        await kernel.initialize();

        const app = kernel.getApp();
        app.get('/c', async (c) => {
            const cache = c.get('cache');
            await cache.set('ctx', 'value');
            return c.json({ value: await cache.get('ctx') });
        });

        const res = await app.request('/c');
        expect(await res.json()).toEqual({ value: 'value' });

        await kernel.shutdown();
    });
});
