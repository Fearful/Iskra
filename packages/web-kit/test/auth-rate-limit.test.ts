import { describe, it, expect, afterEach, setSystemTime } from 'bun:test';

// Test for the MEDIUM "rate-limit auth routes" finding
// (src/features/auth/index.ts). The auth feature must apply per-IP rate limiting
// to its routes by default so credential-stuffing / brute-force against sign-in
// and sign-up is throttled. The middleware is installed on `${basePath}/*`; the
// 21st request from the same IP within the window must be rejected with 429,
// while non-auth routes stay unthrottled.

import { AuthFeature } from '../src/features/auth/index';
import { Kernel } from '../src/kernel';

// Inject a fake createBetterAuth through AuthFeature's constructor seam rather
// than globally mocking @iskra-bun/auth-kit. bun's `mock.module` is process-wide
// and cannot be reverted, so a global mock here would leak into auth-kit's own
// security/integration suites and silently disable the real validation under
// test there.
const fakeCreateAuth = (() => ({
    handler: async () => new Response('ok'),
    api: { getSession: async () => null },
})) as any;

class FakeDbFeature {
    name = 'db';
    db = {} as any;
    adapter = 'sqlite' as const;
    async initialize() {}
}

const VALID_SECRET = 'x'.repeat(40);

describe('AuthFeature — per-IP auth-route rate limiting', () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
        process.env.NODE_ENV = originalEnv;
    });

    it('throttles repeated requests to auth routes from the same IP (429)', async () => {
        const kernel = new Kernel({ trustProxy: true });
        kernel.registerFeature(new FakeDbFeature() as any);
        const auth = new AuthFeature({ secret: VALID_SECRET, basePath: '/api/sso' } as any, fakeCreateAuth);
        kernel.registerFeature(auth);
        await kernel.initialize();

        const app = kernel.getApp();
        // A POST route under the auth basePath: POSTs are the attempts counted.
        app.post('/api/sso/ping', (c) => c.text('ok'));

        const headers = { 'x-forwarded-for': '10.0.0.1' };

        // The default budget is 20 requests per IP per window.
        let last = 200;
        for (let i = 0; i < 25; i++) {
            last = (await app.request('/api/sso/ping', { method: 'POST', headers })).status;
        }

        // Once the budget is exhausted the IP must be throttled.
        expect(last).toBe(429);
    });

    it('tells a throttled client when to retry (Retry-After)', async () => {
        // Regression: the 429 had no Retry-After.
        const kernel = new Kernel({ logger: false });
        kernel.registerFeature(new FakeDbFeature() as any);
        kernel.registerFeature(
            new AuthFeature(
                { secret: VALID_SECRET, basePath: '/api/sso', rateLimit: { max: 1, windowMs: 60_000 } } as any,
                fakeCreateAuth,
            ),
        );
        await kernel.initialize();
        const app = kernel.getApp();
        const from = { requestIP: () => ({ address: '198.51.100.7', family: 'IPv4', port: 40000 }) };

        const start = Date.now();
        try {
            setSystemTime(new Date(start));
            await app.request('/api/sso/sign-in/email', { method: 'POST' }, from);
            setSystemTime(new Date(start + 15_000));
            const limited = await app.request('/api/sso/sign-in/email', { method: 'POST' }, from);
            expect(limited.status).toBe(429);
            expect(limited.headers.get('Retry-After')).toBe('45');
        } finally {
            setSystemTime();
            await kernel.shutdown();
        }
    });

    it('does not throttle a different IP (behind a trusted proxy)', async () => {
        const kernel = new Kernel({ trustProxy: true });
        kernel.registerFeature(new FakeDbFeature() as any);
        const auth = new AuthFeature({ secret: VALID_SECRET, basePath: '/api/sso' } as any, fakeCreateAuth);
        kernel.registerFeature(auth);
        await kernel.initialize();

        const app = kernel.getApp();
        app.post('/api/sso/ping', (c) => c.text('ok'));

        // Exhaust the budget for one IP.
        for (let i = 0; i < 25; i++) {
            await app.request('/api/sso/ping', { method: 'POST', headers: { 'x-forwarded-for': '10.0.0.1' } });
        }

        // A fresh IP starts with a full budget and is not throttled.
        const res = await app.request('/api/sso/ping', { method: 'POST', headers: { 'x-forwarded-for': '10.0.0.2' } });
        expect(res.status).toBe(200);
    });

    it('leaves non-auth routes unthrottled', async () => {
        const kernel = new Kernel();
        kernel.registerFeature(new FakeDbFeature() as any);
        const auth = new AuthFeature({ secret: VALID_SECRET, basePath: '/api/sso' } as any, fakeCreateAuth);
        kernel.registerFeature(auth);
        await kernel.initialize();

        const app = kernel.getApp();
        app.get('/public', (c) => c.text('ok'));

        const headers = { 'x-forwarded-for': '10.0.0.3' };
        let last = 200;
        for (let i = 0; i < 30; i++) {
            last = (await app.request('/public', { headers })).status;
        }
        expect(last).toBe(200);
    });

    it('cannot be bypassed by rotating X-Forwarded-For without trustProxy', async () => {
        // Regression: the limiter keyed on the raw header, so a new value per
        // request gave the attacker a fresh budget every time.
        const kernel = new Kernel();
        kernel.registerFeature(new FakeDbFeature() as any);
        const auth = new AuthFeature({ secret: VALID_SECRET, basePath: '/api/sso' } as any, fakeCreateAuth);
        kernel.registerFeature(auth);
        await kernel.initialize();

        const app = kernel.getApp();
        app.post('/api/sso/ping', (c) => c.text('ok'));

        const socket = { requestIP: () => ({ address: '203.0.113.9', family: 'IPv4', port: 40000 }) };
        let last = 200;
        for (let i = 0; i < 25; i++) {
            const headers = { 'x-forwarded-for': `10.1.0.${i}` };
            last = (await app.request('/api/sso/ping', { method: 'POST', headers }, socket)).status;
        }
        expect(last).toBe(429);
    });

    it('counts an IPv6 client by its /64, so rotating addresses in it does not help', async () => {
        const kernel = new Kernel({ logger: false });
        kernel.registerFeature(new FakeDbFeature() as any);
        kernel.registerFeature(
            new AuthFeature(
                { secret: VALID_SECRET, basePath: '/api/sso', rateLimit: { max: 3 } } as any,
                fakeCreateAuth,
            ),
        );
        await kernel.initialize();
        const app = kernel.getApp();

        const from = (address: string) => ({ requestIP: () => ({ address, family: 'IPv6', port: 40000 }) });
        const statuses: number[] = [];
        for (let i = 1; i <= 5; i++) {
            const res = await app.request('/api/sso/sign-in/email', { method: 'POST' }, from(`2001:db8:5:6::${i}`));
            statuses.push(res.status);
        }
        expect(statuses).toEqual([200, 200, 200, 429, 429]);
        await kernel.shutdown();
    });

    it("reads the kernel's clientIpHeader behind a trusted proxy", async () => {
        const kernel = new Kernel({ trustProxy: 1, clientIpHeader: 'x-real-ip', logger: false });
        kernel.registerFeature(new FakeDbFeature() as any);
        kernel.registerFeature(
            new AuthFeature(
                { secret: VALID_SECRET, basePath: '/api/sso', rateLimit: { max: 2 } } as any,
                fakeCreateAuth,
            ),
        );
        await kernel.initialize();
        const app = kernel.getApp();

        const proxy = { requestIP: () => ({ address: '10.0.0.2', family: 'IPv4', port: 40000 }) };
        const statuses: number[] = [];
        for (let i = 0; i < 3; i++) {
            const headers = { 'x-real-ip': '198.51.100.20', 'x-forwarded-for': `6.6.6.${i}` };
            statuses.push((await app.request('/api/sso/sign-in/email', { method: 'POST', headers }, proxy)).status);
        }
        expect(statuses).toEqual([200, 200, 429]);
        await kernel.shutdown();
    });

    it('honors a configured limit, and rateLimit: false disables it', async () => {
        const build = async (rateLimit: any) => {
            const kernel = new Kernel();
            kernel.registerFeature(new FakeDbFeature() as any);
            kernel.registerFeature(
                new AuthFeature({ secret: VALID_SECRET, basePath: '/api/sso', rateLimit } as any, fakeCreateAuth),
            );
            await kernel.initialize();
            kernel.getApp().post('/api/sso/ping', (c) => c.text('ok'));
            const statuses: number[] = [];
            for (let i = 0; i < 25; i++)
                statuses.push((await kernel.getApp().request('/api/sso/ping', { method: 'POST' })).status);
            return statuses;
        };
        const limited = await build({ max: 3 });
        expect(limited.slice(0, 4)).toEqual([200, 200, 200, 429]);
        expect((await build(false)).every((s) => s === 200)).toBe(true);
    });

    it('does not count session reads, OAuth callbacks or sign-out', async () => {
        const kernel = new Kernel();
        kernel.registerFeature(new FakeDbFeature() as any);
        kernel.registerFeature(
            new AuthFeature(
                { secret: VALID_SECRET, basePath: '/api/sso', rateLimit: { max: 3 } } as any,
                fakeCreateAuth,
            ),
        );
        await kernel.initialize();
        const app = kernel.getApp();

        // A SPA polling get-session used to lock its users out of signing in.
        for (let i = 0; i < 10; i++) {
            expect((await app.request('/api/sso/get-session')).status).toBe(200);
            expect((await app.request('/api/sso/callback/oidc?code=x')).status).toBe(200);
            expect((await app.request('/api/sso/sign-out', { method: 'POST' })).status).toBe(200);
        }
        const attempts: number[] = [];
        for (let i = 0; i < 4; i++) {
            attempts.push((await app.request('/api/sso/sign-in/email', { method: 'POST' })).status);
        }
        expect(attempts).toEqual([200, 200, 200, 429]);
    });
});
