import { describe, expect, it } from 'bun:test';
import type { Hono } from 'hono';
import { Kernel } from '../src/kernel';
import { CsrfFeature } from '../src/features/csrf';
import { RateLimitFeature } from '../src/features/rate-limit';
import type { Feature } from '../src/types';

const csrf = () => new CsrfFeature({ secret: 'csrf-secret-0123456789abcdef0123456789' });

describe('Kernel composition guards', () => {
    it('refuses routes added before initialize(), which would skip every feature middleware', async () => {
        const kernel = new Kernel({ logger: false });
        kernel.registerFeature(csrf());
        kernel.getApp().post('/transfer', (c) => c.text('transferred'));

        await expect(kernel.initialize()).rejects.toThrow(
            /Routes were added before Kernel\.initialize\(\).*POST \/transfer/,
        );
    });

    it('still accepts middleware added before initialize()', async () => {
        const kernel = new Kernel({ logger: false });
        kernel.getApp().use('*', async (_c, next) => next());
        await kernel.initialize();

        kernel.getApp().get('/ok', (c) => c.text('ok'));
        const res = await kernel.getApp().request('/ok');
        expect(res.status).toBe(200);
        expect(res.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
    });

    it('refuses a feature that adds routes in initialize() instead of routes()', async () => {
        const sneaky: Feature = {
            name: 'sneaky',
            async initialize(kernel) {
                kernel.getApp().post('/admin/delete-all', (c) => c.text('deleted'));
            },
        };
        const kernel = new Kernel({ logger: false });
        kernel.registerFeature(sneaky);
        kernel.registerFeature(csrf());

        await expect(kernel.initialize()).rejects.toThrow(/Feature 'sneaky' added routes in initialize\(\)/);
    });

    it("applies later features' middleware to routes a feature registers in routes()", async () => {
        const admin: Feature = {
            name: 'admin',
            async initialize() {},
            routes(app: Hono) {
                app.post('/admin/delete-all', (c) => c.text('deleted'));
            },
        };
        const kernel = new Kernel({ logger: false });
        kernel.registerFeature(admin);
        kernel.registerFeature(csrf());
        await kernel.initialize();

        const res = await kernel.getApp().request('/admin/delete-all', { method: 'POST' });
        expect(res.status).toBe(403);
    });

    it('refuses a second feature with the same name instead of silently replacing the first', () => {
        const kernel = new Kernel({ logger: false });
        kernel.registerFeature(csrf());
        const impostor: Feature = { name: 'csrf', async initialize() {} };

        expect(() => kernel.registerFeature(impostor)).toThrow(/feature named 'csrf' is already registered/);
        expect(kernel.getFeature('csrf')).toBeInstanceOf(CsrfFeature);
    });

    it('keeps two named rate limiters apart', async () => {
        const kernel = new Kernel({ logger: false });
        kernel.registerFeature(new RateLimitFeature({ max: 3, keyGenerator: () => 'client' }));
        kernel.registerFeature(
            new RateLimitFeature({
                name: 'login-rate-limit',
                max: 1,
                keyGenerator: () => 'client',
                skip: (c) => c.req.path !== '/login',
            }),
        );
        await kernel.initialize();
        kernel.getApp().get('/', (c) => c.text('ok'));
        kernel.getApp().post('/login', (c) => c.text('ok'));

        // The global limiter still applies: it was dropped when both were 'rate-limit'.
        const statuses: number[] = [];
        for (let i = 0; i < 4; i++) statuses.push((await kernel.getApp().request('/')).status);
        expect(statuses).toEqual([200, 200, 200, 429]);

        // The login limiter counts on its own (the global one is already spent).
        const login = await kernel.getApp().request('/login', { method: 'POST' });
        expect(login.status).toBe(429);

        await kernel.shutdown();
    });

    it('keeps a stricter header the route set itself', async () => {
        const kernel = new Kernel({
            logger: false,
            securityHeaders: { contentSecurityPolicy: "default-src 'self'" },
        });
        await kernel.initialize();
        kernel.getApp().get('/upload/view', (c) => {
            c.header('Content-Security-Policy', "sandbox; default-src 'none'");
            c.header('X-Frame-Options', 'DENY');
            return c.html('<p>user content</p>');
        });
        kernel.getApp().get('/', (c) => c.text('ok'));

        const own = await kernel.getApp().request('/upload/view');
        expect(own.headers.get('Content-Security-Policy')).toBe("sandbox; default-src 'none'");
        expect(own.headers.get('X-Frame-Options')).toBe('DENY');
        expect(own.headers.get('X-Content-Type-Options')).toBe('nosniff');

        const other = await kernel.getApp().request('/');
        expect(other.headers.get('Content-Security-Policy')).toBe("default-src 'self'");
        expect(other.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
    });

    it('honours strictTransportSecurity.maxAge: 0 (it became a year)', async () => {
        const kernel = new Kernel({ logger: false, securityHeaders: { strictTransportSecurity: { maxAge: 0 } } });
        await kernel.initialize();
        kernel.getApp().get('/', (c) => c.text('ok'));

        const res = await kernel.getApp().request('/');
        expect(res.headers.get('Strict-Transport-Security')).toBe('max-age=0');
    });

    it('initializes optional dependencies first when they are registered, and needs none of them', async () => {
        const order: string[] = [];
        const feature = (name: string, optionalDependencies?: string[]): Feature => ({
            name,
            optionalDependencies,
            async initialize() {
                order.push(name);
            },
        });
        const kernel = new Kernel({ logger: false });
        kernel.registerFeature(feature('csrf-like', ['session-like', 'absent']));
        kernel.registerFeature(feature('session-like'));
        await kernel.initialize();
        expect(order).toEqual(['session-like', 'csrf-like']);
    });
});
