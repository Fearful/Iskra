import { describe, it, expect } from 'bun:test';
import { Kernel } from '../src/kernel';
import { OpenAPIFeature, createRoute } from '../src/features/openapi';
import type { OpenAPIConfig } from '../src/types';

async function docsApp(config: Partial<OpenAPIConfig> = {}) {
    const kernel = new Kernel({ logger: false });
    const openapi = new OpenAPIFeature({ title: 'Pets', version: '1.0.0', ...config });
    openapi.addRoute(createRoute({ method: 'get', path: '/pets', responses: { 200: { description: 'ok' } } }), ((
        c: any,
    ) => c.json([])) as any);
    kernel.registerFeature(openapi);
    await kernel.initialize();
    return kernel.getApp();
}

describe('OpenAPIFeature /docs page', () => {
    it('loads one pinned Scalar release with its SRI hash, not @latest', async () => {
        const app = await docsApp();
        const html = await (await app.request('/docs')).text();

        expect(html).not.toContain('@latest');
        expect(html).toMatch(
            /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@scalar\/api-reference@\d+\.\d+\.\d+\/[^"]+" integrity="sha384-[A-Za-z0-9+/]{64}" crossorigin="anonymous"><\/script>/,
        );
    });

    it('escapes the title', async () => {
        const app = await docsApp({ title: '</title><script>alert(document.cookie)</script>' });
        const html = await (await app.request('/docs')).text();

        expect(html).not.toContain('<script>alert');
        expect(html).toContain('&#60;/title&#62;&#60;script&#62;alert(document.cookie)&#60;/script&#62;');
    });

    it('sends a CSP that allows the script host, and requests only to this origin and the servers', async () => {
        const app = await docsApp({ servers: [{ url: 'https://api.example.com/v1' }, { url: '/relative' }] });
        const csp = (await app.request('/docs')).headers.get('Content-Security-Policy')!;

        expect(csp).toContain("default-src 'none'");
        expect(csp).toContain('script-src https://cdn.jsdelivr.net;');
        expect(csp).toContain("connect-src 'self' https://api.example.com;");
        expect(csp).toContain("frame-ancestors 'self'");
    });

    it('uses the script given in `scalar`, and `scalar: false` leaves the page out', async () => {
        const own = await docsApp({ scalar: { src: '/assets/scalar.js', integrity: 'sha384-abc' } });
        const res = await own.request('/docs');
        expect(await res.text()).toContain(
            '<script src="/assets/scalar.js" integrity="sha384-abc" crossorigin="anonymous">',
        );
        expect(res.headers.get('Content-Security-Policy')).toContain("script-src 'self';");

        const specOnly = await docsApp({ scalar: false });
        expect((await specOnly.request('/docs')).status).toBe(404);
        expect((await specOnly.request('/openapi.json')).status).toBe(200);
    });

    it('serves neither the spec nor the page with docs: false', async () => {
        const app = await docsApp({ docs: false });

        expect((await app.request('/openapi.json')).status).toBe(404);
        expect((await app.request('/docs')).status).toBe(404);
        // The API itself is still served.
        expect((await app.request('/pets')).status).toBe(200);
    });

    it('asks authorize() before serving the spec or the page', async () => {
        const decisions: boolean[] = [];
        const app = await docsApp({
            authorize: (c) => {
                const allowed = c.req.header('X-Docs-Key') === 'let-me-in';
                decisions.push(allowed);
                return allowed;
            },
        });

        expect((await app.request('/openapi.json')).status).toBe(403);
        expect((await app.request('/docs')).status).toBe(403);
        expect((await app.request('/docs', { headers: { 'X-Docs-Key': 'let-me-in' } })).status).toBe(200);
        expect((await app.request('/openapi.json', { headers: { 'X-Docs-Key': 'let-me-in' } })).status).toBe(200);
        expect(decisions).toEqual([false, false, true, true]);
    });

    it('sends the Response authorize() returns, e.g. a Basic auth challenge', async () => {
        const credentials = `Basic ${btoa('docs:s3cret')}`;
        const app = await docsApp({
            authorize: (c) =>
                c.req.header('Authorization') === credentials ||
                c.text('Unauthorized', 401, { 'WWW-Authenticate': 'Basic realm="docs"' }),
        });

        const denied = await app.request('/docs');
        expect(denied.status).toBe(401);
        expect(denied.headers.get('WWW-Authenticate')).toBe('Basic realm="docs"');
        expect((await app.request('/docs', { headers: { Authorization: credentials } })).status).toBe(200);
    });
});
