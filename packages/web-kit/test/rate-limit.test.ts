import { describe, expect, it, setSystemTime } from 'bun:test';
import { Kernel } from '../src/kernel';
import { RateLimitFeature } from '../src/features/rate-limit';
import { CacheFeature } from '../src/features/cache';
import { HealthCheckFeature } from '../src/features/health';
import type { KernelLogger } from '../src/logging';

describe('Rate Limit Feature', () => {
    it('should allow requests within the limit', async () => {
        const kernel = new Kernel();
        kernel.registerFeature(
            new RateLimitFeature({
                windowMs: 5000,
                max: 5,
                keyGenerator: () => 'test-user',
            }),
        );
        await kernel.initialize();

        const app = kernel.getApp();
        app.get('/test', (c) => c.text('ok'));

        for (let i = 0; i < 5; i++) {
            const res = await app.request('/test');
            expect(res.status).toBe(200);
        }

        await kernel.shutdown();
    });

    it('should return 429 when limit is exceeded', async () => {
        const kernel = new Kernel();
        kernel.registerFeature(
            new RateLimitFeature({
                windowMs: 5000,
                max: 2,
                keyGenerator: () => 'rate-test',
            }),
        );
        await kernel.initialize();

        const app = kernel.getApp();
        app.get('/limited', (c) => c.text('ok'));

        expect((await app.request('/limited')).status).toBe(200);
        expect((await app.request('/limited')).status).toBe(200);
        expect((await app.request('/limited')).status).toBe(429);

        await kernel.shutdown();
    });

    it('should set standard rate limit headers', async () => {
        const kernel = new Kernel();
        kernel.registerFeature(
            new RateLimitFeature({
                windowMs: 10000,
                max: 10,
                keyGenerator: () => 'headers-test',
                standardHeaders: true,
            }),
        );
        await kernel.initialize();

        const app = kernel.getApp();
        app.get('/headers', (c) => c.text('ok'));

        const res = await app.request('/headers');
        expect(res.headers.get('X-RateLimit-Limit')).toBe('10');
        expect(res.headers.get('X-RateLimit-Remaining')).toBe('9');
        expect(res.headers.get('X-RateLimit-Reset')).toBeDefined();

        await kernel.shutdown();
    });

    it('reports the window reset time, not now + windowMs on every request', async () => {
        const kernel = new Kernel();
        kernel.registerFeature(
            new RateLimitFeature({
                windowMs: 60_000,
                max: 10,
                keyGenerator: () => 'reset-test',
            }),
        );
        await kernel.initialize();

        const app = kernel.getApp();
        app.get('/reset', (c) => c.text('ok'));

        const start = Date.now();
        try {
            setSystemTime(new Date(start));
            const first = await app.request('/reset');
            setSystemTime(new Date(start + 20_000));
            const second = await app.request('/reset');

            expect(second.headers.get('X-RateLimit-Remaining')).toBe('8');
            expect(second.headers.get('X-RateLimit-Reset')).toBe(first.headers.get('X-RateLimit-Reset'));
            expect(first.headers.get('X-RateLimit-Reset')).toBe(String(Math.ceil((start + 60_000) / 1000)));
        } finally {
            setSystemTime();
            await kernel.shutdown();
        }
    });

    it('answers a 429 with Retry-After until the window resets', async () => {
        // Regression: the 429 said nothing about when to retry.
        const kernel = new Kernel({ logger: false });
        kernel.registerFeature(new RateLimitFeature({ windowMs: 60_000, max: 1, keyGenerator: () => 'retry-test' }));
        await kernel.initialize();
        const app = kernel.getApp();
        app.get('/retry', (c) => c.text('ok'));

        const start = Date.now();
        try {
            setSystemTime(new Date(start));
            expect((await app.request('/retry')).headers.get('Retry-After')).toBeNull();
            setSystemTime(new Date(start + 20_500));
            const limited = await app.request('/retry');
            expect(limited.status).toBe(429);
            expect(limited.headers.get('Retry-After')).toBe('40');
        } finally {
            setSystemTime();
            await kernel.shutdown();
        }
    });

    it('falls back to windowMs for Retry-After when the store does not know the reset', async () => {
        const kernel = new Kernel({ logger: false });
        kernel.registerFeature(new CacheFeature({ adapter: 'memory' }));
        kernel.registerFeature(
            new RateLimitFeature({ windowMs: 30_000, max: 1, store: 'cache', keyGenerator: () => 'retry-cache' }),
        );
        await kernel.initialize();
        const app = kernel.getApp();
        app.get('/retry', (c) => c.text('ok'));

        await app.request('/retry');
        const limited = await app.request('/retry');
        expect(limited.status).toBe(429);
        expect(limited.headers.get('Retry-After')).toBe('30');
        await kernel.shutdown();
    });

    it('should skip rate limiting when skip function returns true', async () => {
        const kernel = new Kernel();
        kernel.registerFeature(
            new RateLimitFeature({
                windowMs: 5000,
                max: 1,
                keyGenerator: () => 'skip-test',
                skip: () => true,
            }),
        );
        await kernel.initialize();

        const app = kernel.getApp();
        app.get('/skip', (c) => c.text('ok'));

        // All requests should pass even though max is 1
        expect((await app.request('/skip')).status).toBe(200);
        expect((await app.request('/skip')).status).toBe(200);
        expect((await app.request('/skip')).status).toBe(200);

        await kernel.shutdown();
    });

    it('should work with cache store', async () => {
        const kernel = new Kernel();
        kernel.registerFeature(new CacheFeature({ adapter: 'memory' }));
        kernel.registerFeature(
            new RateLimitFeature({
                windowMs: 5000,
                max: 2,
                store: 'cache',
                keyGenerator: () => 'cache-rl-test',
            }),
        );
        await kernel.initialize();

        const app = kernel.getApp();
        app.get('/cache-rl', (c) => c.text('ok'));

        expect((await app.request('/cache-rl')).status).toBe(200);
        expect((await app.request('/cache-rl')).status).toBe(200);
        expect((await app.request('/cache-rl')).status).toBe(429);

        await kernel.shutdown();
    });

    it('should decrement remaining count with each request', async () => {
        const kernel = new Kernel();
        kernel.registerFeature(
            new RateLimitFeature({
                windowMs: 10000,
                max: 3,
                keyGenerator: () => 'decrement-test',
            }),
        );
        await kernel.initialize();

        const app = kernel.getApp();
        app.get('/dec', (c) => c.text('ok'));

        const res1 = await app.request('/dec');
        expect(res1.headers.get('X-RateLimit-Remaining')).toBe('2');

        const res2 = await app.request('/dec');
        expect(res2.headers.get('X-RateLimit-Remaining')).toBe('1');

        const res3 = await app.request('/dec');
        expect(res3.headers.get('X-RateLimit-Remaining')).toBe('0');

        await kernel.shutdown();
    });

    describe('default client key', () => {
        const socket = (address: string) => ({ requestIP: () => ({ address, family: 'IPv4', port: 40000 }) });

        it('ignores a spoofed X-Forwarded-For unless trustProxy is set', async () => {
            // Regression: the key used to be the raw X-Forwarded-For header, so a
            // client rotating it was never limited.
            const kernel = new Kernel();
            kernel.registerFeature(new RateLimitFeature({ windowMs: 5000, max: 2 }));
            await kernel.initialize();
            const app = kernel.getApp();
            app.get('/x', (c) => c.text('ok'));

            const env = socket('203.0.113.9');
            const statuses = [];
            for (const ip of ['1.1.1.1', '2.2.2.2', '3.3.3.3']) {
                statuses.push((await app.request('/x', { headers: { 'x-forwarded-for': ip } }, env)).status);
            }
            expect(statuses).toEqual([200, 200, 429]);

            await kernel.shutdown();
        });

        it('gives distinct forwarded clients their own bucket behind a trusted proxy', async () => {
            const kernel = new Kernel({ trustProxy: true });
            kernel.registerFeature(new RateLimitFeature({ windowMs: 5000, max: 1 }));
            await kernel.initialize();
            const app = kernel.getApp();
            app.get('/x', (c) => c.text('ok'));

            const proxy = socket('10.0.0.2');
            const req = (ip: string) => app.request('/x', { headers: { 'x-forwarded-for': ip } }, proxy);
            expect((await req('198.51.100.1')).status).toBe(200);
            expect((await req('198.51.100.2')).status).toBe(200);
            expect((await req('198.51.100.1')).status).toBe(429);

            await kernel.shutdown();
        });

        it('behind a proxy that sets X-Real-IP, ignores a made-up X-Forwarded-For', async () => {
            // Regression: X-Real-IP was read only when X-Forwarded-For was
            // absent, so a new X-Forwarded-For per request was a new bucket.
            const kernel = new Kernel({ trustProxy: 1, clientIpHeader: 'x-real-ip', logger: false });
            kernel.registerFeature(new RateLimitFeature({ windowMs: 5000, max: 1 }));
            await kernel.initialize();
            const app = kernel.getApp();
            app.get('/x', (c) => c.text('ok'));

            const proxy = socket('10.0.0.2');
            const statuses = [];
            for (const fake of ['1.1.1.1', '2.2.2.2', '3.3.3.3']) {
                const headers = { 'x-real-ip': '198.51.100.1', 'x-forwarded-for': fake };
                statuses.push((await app.request('/x', { headers }, proxy)).status);
            }
            expect(statuses).toEqual([200, 429, 429]);

            await kernel.shutdown();
        });

        it('counts an IPv6 client by its /64', async () => {
            // Regression: each address was its own bucket, and one host has
            // a whole /64 to rotate through.
            const kernel = new Kernel({ trustProxy: 1, logger: false });
            kernel.registerFeature(new RateLimitFeature({ windowMs: 5000, max: 2 }));
            await kernel.initialize();
            const app = kernel.getApp();
            app.get('/x', (c) => c.text('ok'));

            const proxy = socket('10.0.0.2');
            const req = (ip: string) => app.request('/x', { headers: { 'x-forwarded-for': ip } }, proxy);
            const statuses = [];
            for (const ip of ['2001:db8:1:2::1', '2001:db8:1:2::2', '2001:db8:1:2:abcd::3']) {
                statuses.push((await req(ip)).status);
            }
            expect(statuses).toEqual([200, 200, 429]);
            // Another /64 is another client.
            expect((await req('2001:db8:1:3::1')).status).toBe(200);

            await kernel.shutdown();
        });
    });

    it('tracks at most maxKeys clients, dropping the oldest', async () => {
        // Regression: the memory store grew with every key until its entries
        // expired (15 min by default), whatever their number.
        const kernel = new Kernel({ logger: false });
        kernel.registerFeature(
            new RateLimitFeature({ windowMs: 60_000, max: 1, maxKeys: 2, keyGenerator: (c) => c.req.query('k')! }),
        );
        await kernel.initialize();
        const app = kernel.getApp();
        app.get('/x', (c) => c.text('ok'));

        const req = async (k: string) => (await app.request(`/x?k=${k}`)).status;
        expect([await req('a'), await req('a')]).toEqual([200, 429]);
        expect([await req('b'), await req('c')]).toEqual([200, 200]);
        // 'a' was the oldest of three keys: forgotten, it starts a new window.
        expect(await req('a')).toBe(200);
        // 'c' is still counted.
        expect(await req('c')).toBe(429);

        await kernel.shutdown();
    });

    describe('health checks', () => {
        async function setup(
            rateLimit: ConstructorParameters<typeof RateLimitFeature>[0],
            health?: HealthCheckFeature,
        ) {
            const kernel = new Kernel({ logger: false });
            // Registered before the health feature: the paths are looked up at request time.
            kernel.registerFeature(new RateLimitFeature({ max: 2, keyGenerator: () => 'probe', ...rateLimit }));
            kernel.registerFeature(health ?? new HealthCheckFeature());
            await kernel.initialize();
            kernel.getApp().get('/api', (c) => c.text('ok'));
            return kernel;
        }

        it('does not count the health routes (a kubelet probing every 10 s went over the limit)', async () => {
            const kernel = await setup({});
            const app = kernel.getApp();
            for (let i = 0; i < 5; i++) {
                for (const path of ['/health', '/health/ready', '/health/live']) {
                    expect((await app.request(path)).status).toBe(200);
                }
            }
            // They took nothing from the client's budget either.
            expect([(await app.request('/api')).status, (await app.request('/api')).status]).toEqual([200, 200]);
            expect((await app.request('/api')).status).toBe(429);
            await kernel.shutdown();
        });

        it('skips the paths the health feature is configured with', async () => {
            const kernel = await setup(
                {},
                new HealthCheckFeature({ livenessPath: '/livez', readinessPath: '/readyz' }),
            );
            const app = kernel.getApp();
            for (let i = 0; i < 4; i++) expect((await app.request('/livez')).status).toBe(200);
            for (let i = 0; i < 4; i++) expect((await app.request('/readyz')).status).toBe(200);
            await kernel.shutdown();
        });

        it('counts them with skipHealthChecks: false', async () => {
            const kernel = await setup({ skipHealthChecks: false });
            const app = kernel.getApp();
            const statuses = [];
            for (let i = 0; i < 3; i++) statuses.push((await app.request('/health/live')).status);
            expect(statuses).toEqual([200, 200, 429]);
            await kernel.shutdown();
        });
    });

    it('warns once when requests come through a proxy that trustProxy does not cover', async () => {
        const warnings: string[] = [];
        const noop = () => {};
        const logger: KernelLogger = { debug: noop, info: noop, error: noop, warn: (m) => warnings.push(m) };
        const kernel = new Kernel({ logger });
        kernel.registerFeature(new RateLimitFeature({ max: 100 }));
        await kernel.initialize();
        const app = kernel.getApp();
        app.get('/x', (c) => c.text('ok'));

        await app.request('/x');
        expect(warnings.filter((w) => w.includes('trustProxy'))).toHaveLength(0);
        for (let i = 0; i < 3; i++) await app.request('/x', { headers: { 'X-Forwarded-For': '203.0.113.7' } });
        expect(warnings.filter((w) => w.includes('trustProxy'))).toHaveLength(1);
        await kernel.shutdown();
    });

    it('does not warn about the proxy when trustProxy is set', async () => {
        const warnings: string[] = [];
        const noop = () => {};
        const logger: KernelLogger = { debug: noop, info: noop, error: noop, warn: (m) => warnings.push(m) };
        const kernel = new Kernel({ logger, trustProxy: 1 });
        kernel.registerFeature(new RateLimitFeature({ max: 100 }));
        await kernel.initialize();
        const app = kernel.getApp();
        app.get('/x', (c) => c.text('ok'));

        await app.request('/x', { headers: { 'X-Forwarded-For': '203.0.113.7' } });
        expect(warnings.filter((w) => w.includes('trustProxy'))).toHaveLength(0);
        await kernel.shutdown();
    });
});
