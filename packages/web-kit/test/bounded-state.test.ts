import { afterEach, describe, expect, it, jest } from 'bun:test';
import { join } from 'node:path';
import { Kernel } from '../src/kernel';
import { CacheFeature } from '../src/features/cache';
import { HitCounter } from '../src/hit-counter';

// The in-memory state of the limiters and the memory cache grows with the
// number of clients: it must be swept, capped, and not keep the process alive.

afterEach(() => {
    jest.useRealTimers();
});

describe('HitCounter', () => {
    it('sweeps expired keys every minute', () => {
        jest.useFakeTimers();
        const hits = new HitCounter();
        for (let i = 0; i < 50; i++) hits.hit(`client-${i}`, 1000);
        expect(hits.size).toBe(50);

        jest.advanceTimersByTime(61_000);
        expect(hits.size).toBe(0);
        hits.dispose();
    });

    it('drops the oldest keys past maxKeys', () => {
        const hits = new HitCounter(3);
        for (const key of ['a', 'b', 'c', 'd']) hits.hit(key, 60_000);
        expect(hits.size).toBe(3);
        expect(hits.hit('a', 60_000)).toBe(1); // forgotten: a new window
        expect(hits.hit('d', 60_000)).toBe(2);
        hits.dispose();
    });
});

describe('CacheFeature memory adapter', () => {
    const storeSize = (cache: CacheFeature) => (cache.client as any).store.size as number;

    it('sweeps expired entries instead of keeping them until they are read', async () => {
        // Regression: entries were only removed when read again, so keys
        // written once (a counter per client) stayed forever.
        jest.useFakeTimers();
        const kernel = new Kernel({ logger: false });
        const cache = new CacheFeature({ adapter: 'memory' });
        kernel.registerFeature(cache);
        await kernel.initialize();

        for (let i = 0; i < 20; i++) await cache.client.set(`k${i}`, i, 1);
        await cache.client.set('kept', 'forever');
        expect(storeSize(cache)).toBe(21);

        jest.advanceTimersByTime(61_000);
        expect(storeSize(cache)).toBe(1);
        expect(await cache.client.get('kept')).toBe('forever');
        await kernel.shutdown();
    });

    it('keeps at most maxEntries, dropping the oldest writes', async () => {
        const kernel = new Kernel({ logger: false });
        const cache = new CacheFeature({ adapter: 'memory', maxEntries: 2 });
        kernel.registerFeature(cache);
        await kernel.initialize();

        await cache.client.set('a', 1);
        await cache.client.set('b', 2);
        await cache.client.set('a', 3); // rewritten: now the newest
        await cache.client.set('c', 4);
        expect(await cache.client.get('b')).toBeNull();
        expect(await cache.client.get('a')).toBe(3);
        expect(await cache.client.get('c')).toBe(4);
        await kernel.shutdown();
    });

    it('does not report an expired entry as existing', async () => {
        const kernel = new Kernel({ logger: false });
        const cache = new CacheFeature({ adapter: 'memory' });
        kernel.registerFeature(cache);
        await kernel.initialize();

        await cache.client.set('short', 'x', 0.01);
        await Bun.sleep(30);
        expect(await cache.client.exists('short')).toBe(false);
        await kernel.shutdown();
    });
});

describe('sweep timers', () => {
    it('do not keep the process alive when the kernel is not shut down', () => {
        // Regression: the rate limiter's, the memory cache's and the memory
        // session store's intervals kept an app that never called shutdown()
        // (a script, a test file) running forever.
        const child = Bun.spawnSync([process.execPath, join(import.meta.dir, 'fixtures/no-shutdown.ts')], {
            stdout: 'pipe',
            stderr: 'pipe',
            timeout: 10_000,
        });
        expect(child.stdout.toString()).toContain('STATUS 200');
        expect(child.exitCode).toBe(0);
    }, 20_000);
});
