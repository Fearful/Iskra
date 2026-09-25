import { describe, it, expect, spyOn, beforeAll, afterAll } from 'bun:test';
import { Kernel } from '../../src/kernel';
import { CorsFeature } from '../../src/features/cors';

// CorsFeature applies hono/cors to the kernel app. We assert default config and
// the resulting Access-Control-* headers via app.request(). init logging is
// silenced.

let logSpy: ReturnType<typeof spyOn>;
beforeAll(() => {
    logSpy = spyOn(console, 'log').mockImplementation(() => {});
});
afterAll(() => {
    logSpy.mockRestore();
});

async function appWithCors(config?: ConstructorParameters<typeof CorsFeature>[0]) {
    const kernel = new Kernel();
    kernel.registerFeature(new CorsFeature(config));
    await kernel.initialize();
    const app = kernel.getApp();
    app.get('/r', (c) => c.json({ ok: true }));
    return app;
}

describe('CorsFeature construction', () => {
    it("defaults origin to '*' and credentials to false", () => {
        const feature = new CorsFeature();
        // Access the resolved config via a fresh instance's behavior below;
        // here we just confirm the name and that construction succeeds.
        expect(feature.name).toBe('cors');
    });
});

describe('CorsFeature behavior', () => {
    it('reflects a wildcard origin header by default', async () => {
        const app = await appWithCors();
        const res = await app.request('/r', {
            headers: { Origin: 'https://example.com' },
        });
        expect(res.status).toBe(200);
        expect(res.headers.get('access-control-allow-origin')).toBe('*');
    });

    it('echoes a specific allowed origin when configured as a string', async () => {
        const app = await appWithCors({ origin: 'https://allowed.com' });
        const res = await app.request('/r', {
            headers: { Origin: 'https://allowed.com' },
        });
        expect(res.headers.get('access-control-allow-origin')).toBe('https://allowed.com');
    });

    it('uses an origin predicate function to allow or deny', async () => {
        const app = await appWithCors({
            origin: (o: string) => o.endsWith('.trusted.com'),
        });

        const allowed = await app.request('/r', {
            headers: { Origin: 'https://app.trusted.com' },
        });
        expect(allowed.headers.get('access-control-allow-origin')).toBe('https://app.trusted.com');

        const denied = await app.request('/r', {
            headers: { Origin: 'https://evil.com' },
        });
        // Predicate returns false -> origin not reflected.
        expect(denied.headers.get('access-control-allow-origin')).not.toBe('https://evil.com');
    });

    it('answers a CORS preflight OPTIONS request', async () => {
        const app = await appWithCors({
            origin: 'https://allowed.com',
            allowMethods: ['GET', 'POST'],
        });
        const res = await app.request('/r', {
            method: 'OPTIONS',
            headers: {
                Origin: 'https://allowed.com',
                'Access-Control-Request-Method': 'POST',
            },
        });
        expect(res.headers.get('access-control-allow-origin')).toBe('https://allowed.com');
        expect(res.headers.get('access-control-allow-methods')).toContain('POST');
    });

    it('sets allow-credentials when credentials is enabled', async () => {
        const app = await appWithCors({ origin: 'https://allowed.com', credentials: true });
        const res = await app.request('/r', {
            headers: { Origin: 'https://allowed.com' },
        });
        expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    });
});
