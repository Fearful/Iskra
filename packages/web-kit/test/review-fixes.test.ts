import { describe, it, expect } from 'bun:test';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { App } from '@iskra-bun/core';
import { Kernel } from '../src/kernel';
import { CsrfFeature } from '../src/features/csrf';
import { ErrorHandlerFeature } from '../src/features/error-handler';
import { HealthCheckFeature } from '../src/features/health';
import { OpenAPIFeature } from '../src/features/openapi';
import { RateLimitFeature } from '../src/features/rate-limit';
import { SessionFeature } from '../src/features/session';
import { WebDriver } from '../src/server';
import type { Feature } from '../src/types';

/** A feature with a POST route, registered before the middleware features. */
class RoutesFeature implements Feature {
    name = 'routes-first';
    async initialize() {}
    routes(app: any) {
        app.post('/early', (c: any) => c.text('ok'));
    }
}

describe('Kernel feature order', () => {
    it("applies later features' middleware to earlier features' routes", async () => {
        const kernel = new Kernel();
        kernel.registerFeature(new RoutesFeature());
        kernel.registerFeature(new CsrfFeature({ secret: 'x'.repeat(40) }));
        await kernel.initialize();
        // Registered right after its own initialize(), the route ran before
        // the CSRF middleware existed and was never checked.
        const res = await kernel.getApp().request('/early', { method: 'POST' });
        expect(res.status).toBe(403);
    });

    it('rate-limits health routes of a HealthCheckFeature registered first', async () => {
        const kernel = new Kernel();
        kernel.registerFeature(new HealthCheckFeature({ path: '/health' }));
        kernel.registerFeature(new RateLimitFeature({ max: 1, windowMs: 60_000 }));
        await kernel.initialize();
        const app = kernel.getApp();
        expect((await app.request('/health')).status).toBe(200);
        expect((await app.request('/health')).status).toBe(429);
    });

    it('requires the cache feature for a rate limit stored in the cache', async () => {
        const kernel = new Kernel();
        kernel.registerFeature(new RateLimitFeature({ store: 'cache' }));
        // It used to fall back silently to a per-process memory store.
        await expect(kernel.initialize()).rejects.toThrow(/requires feature 'cache'/);
    });
});

describe('OpenAPIFeature', () => {
    it('serves a route added after the kernel initialized', async () => {
        const kernel = new Kernel();
        const openapi = new OpenAPIFeature({ title: 't', version: '1' });
        kernel.registerFeature(openapi);
        await kernel.initialize();
        openapi.addRoute({ method: 'get', path: '/late', responses: { 200: { description: 'ok' } } }, (c: any) =>
            c.json({ late: true }),
        );
        const app = kernel.getApp();
        expect((await (await app.request('/openapi.json')).json()).paths['/late']).toBeDefined();
        // It was listed in the spec but answered 404.
        expect(await (await app.request('/late')).json()).toEqual({ late: true });
    });
});

describe('HTTPException with a custom response', () => {
    const basicAuthLike = () => {
        throw new HTTPException(401, {
            res: new Response('Unauthorized', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="x"' } }),
        });
    };

    it('is sent as is by the kernel and by the ErrorHandlerFeature', async () => {
        for (const withHandler of [false, true]) {
            const kernel = new Kernel();
            if (withHandler) kernel.registerFeature(new ErrorHandlerFeature());
            await kernel.initialize();
            kernel.getApp().get('/private', basicAuthLike);
            const res = await kernel.getApp().request('/private');
            expect(res.status).toBe(401);
            // Without it the browser never shows the login prompt.
            expect(res.headers.get('WWW-Authenticate')).toBe('Basic realm="x"');
        }
    });
});

describe('HealthCheckFeature readiness', () => {
    it('times out a hung readiness check', async () => {
        const kernel = new Kernel();
        kernel.registerFeature(
            new HealthCheckFeature({
                checkTimeoutMs: 100,
                readinessChecks: { hung: () => new Promise<boolean>(() => {}) },
            }),
        );
        await kernel.initialize();
        const started = Date.now();
        const res = await kernel.getApp().request('/health/ready');
        expect(res.status).toBe(503);
        expect(Date.now() - started).toBeLessThan(2000);
    });
});

describe('SessionFeature with a db store', () => {
    it('retries creating the sessions table after a failure', async () => {
        let attempts = 0;
        // A database that is unreachable for the first statement.
        const db: any = {
            run: async () => {
                attempts++;
                if (attempts === 1) throw new Error('connection refused');
            },
        };
        const kernel = new Kernel();
        kernel.registerFeature({ name: 'db', db, adapter: 'sqlite', async initialize() {} } as any);
        kernel.registerFeature(new SessionFeature({ secret: 's'.repeat(40), store: 'db' }));
        await kernel.initialize();
        const store = (kernel.getFeature('session') as any).store;
        const realNow = Date.now;
        try {
            await store.get('a').catch(() => null);
            Date.now = () => realNow() + 10_000;
            await store.get('b').catch(() => null);
        } finally {
            Date.now = realNow;
        }
        // It was marked created after the failure and never tried again.
        expect(attempts).toBe(2);
    });
});

describe('WebDriver', () => {
    it('validates a JSON body schema whatever the Content-Type, without X-XSS-Protection', async () => {
        const app = new App({ name: 'WebDriverReview', logger: { level: 'silent' } } as any);
        const driver = new WebDriver({
            routes: [
                {
                    method: 'POST',
                    path: '/users',
                    schema: { body: z.object({ name: z.string(), role: z.enum(['user']) }) },
                    handler: (ctx: any) => ({ got: ctx.body }),
                },
            ],
        });
        driver.init(app);
        const server = (driver as any).server;
        const post = (contentType?: string) =>
            server.request('/users', {
                method: 'POST',
                headers: contentType ? { 'content-type': contentType } : {},
                body: JSON.stringify({ role: 'admin' }),
            });
        expect((await post('application/json')).status).toBe(400);
        // text/plain or no Content-Type used to skip validation (handler got {}).
        expect((await post('text/plain')).status).toBe(400);
        expect((await post()).status).toBe(400);
        const ok = await server.request('/users', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'a', role: 'user' }),
        });
        expect(ok.status).toBe(200);
        expect(ok.headers.get('X-XSS-Protection')).toBeNull();
    });
});
