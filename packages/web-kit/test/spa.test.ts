import { afterAll, afterEach, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Kernel } from '../src/kernel';
import { HealthCheckFeature } from '../src/features/health';
import { SpaFeature, scriptSafeJson, type SpaConfig } from '../src/features/spa';
import type { KernelLogger } from '../src/logging';

const INDEX = `<!doctype html><html><head><title>Board</title><script type="module" crossorigin src="/assets/index-a1b2c3d4.js"></script></head><body><div id="app"></div></body></html>`;

const base = mkdtempSync(join(tmpdir(), 'iskra-spa-'));
const dist = join(base, 'dist');
mkdirSync(join(dist, 'assets'), { recursive: true });
writeFileSync(join(dist, 'index.html'), INDEX);
writeFileSync(join(dist, 'assets', 'index-a1b2c3d4.js'), 'console.log("app")');
writeFileSync(join(dist, 'robots.txt'), 'User-agent: *');
writeFileSync(join(dist, '.env'), 'SECRET=1');
writeFileSync(join(base, 'outside.txt'), 'outside the root');
symlinkSync(join(base, 'outside.txt'), join(dist, 'linked.txt'));
afterAll(() => rmSync(base, { recursive: true, force: true }));

const savedEnv = process.env.NODE_ENV;
afterEach(() => {
    if (savedEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedEnv;
});

async function setup(config: Partial<SpaConfig> = {}) {
    const warnings: string[] = [];
    const logger: KernelLogger = { debug() {}, info() {}, warn: (m) => warnings.push(m), error() {} };
    const kernel = new Kernel({ logger });
    const spa = new SpaFeature({ root: dist, exclude: ['/api', '/hooks'], ...config });
    kernel.registerFeature(new HealthCheckFeature());
    kernel.registerFeature(spa);
    await kernel.initialize();
    const app = kernel.getApp();
    // App routes, added after the features like WebPlugin's router.
    app.get('/projects', (c) => c.json({ projects: [] }));
    app.post('/hooks/gitlab', (c) => c.json({ ok: true }));
    return { app, spa, warnings };
}

const html = { accept: 'text/html,application/xhtml+xml' };

describe('SpaFeature', () => {
    it('serves a hashed asset as immutable', async () => {
        const { app } = await setup();
        const res = await app.request('/assets/index-a1b2c3d4.js');
        expect(res.status).toBe(200);
        expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
        expect(res.headers.get('content-type')).toContain('javascript');
        expect(await res.text()).toBe('console.log("app")');
    });

    it('answers a client route with the page, revalidated, and its config', async () => {
        const { app } = await setup({ config: () => ({ apiUrl: 'https://board.example.com/api', env: 'qa' }) });
        for (const path of ['/', '/boards/42', '/boards/42/', '/index.html']) {
            const res = await app.request(path, { headers: html });
            expect(res.status).toBe(200);
            expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
            expect(res.headers.get('cache-control')).toBe('no-cache');
            const body = await res.text();
            expect(body).toContain(
                '<script>window.__APP_CONFIG__={"apiUrl":"https://board.example.com/api","env":"qa"};</script></head>',
            );
        }
        // The fallback runs after every middleware: the security headers apply.
        const page = await app.request('/boards/1');
        expect(page.headers.get('x-content-type-options')).toBe('nosniff');
        expect(page.headers.get('x-frame-options')).toBe('SAMEORIGIN');
        // A path without an extension is a client route even without Accept: text/html.
        expect((await app.request('/settings')).status).toBe(200);
        // One with a dot is one only for a browser navigation.
        expect((await app.request('/users/ana.diaz', { headers: html })).status).toBe(200);
        expect((await app.request('/logo.png', { headers: { accept: 'image/*' } })).status).toBe(404);
    });

    it('leaves the excluded prefixes and the health paths to the response contract', async () => {
        const { app } = await setup();
        for (const path of ['/api', '/api/unknown', '/hooks/other', '/health/extra', '/%61pi/unknown']) {
            const res = await app.request(path, { headers: html });
            expect(res.status).toBe(404);
            expect(res.headers.get('content-type')).toContain('application/json');
        }
        // A prefix matches whole segments only.
        expect((await app.request('/apiary', { headers: html })).status).toBe(200);
    });

    it('never hides a route, nor answers another method', async () => {
        const { app } = await setup();
        expect(await (await app.request('/projects')).json()).toEqual({ projects: [] });
        expect((await app.request('/hooks/gitlab', { method: 'POST' })).status).toBe(200);
        expect((await app.request('/boards/1', { method: 'POST' })).status).toBe(404);
    });

    it('answers a missing hashed asset with 404, not the page', async () => {
        const { app } = await setup();
        const res = await app.request('/assets/index-old00000.js', { headers: html });
        expect(res.status).toBe(404);
    });

    it('serves only regular files under root: no traversal, dotfile or symlink', async () => {
        const { app } = await setup();
        for (const path of [
            '/..%2Foutside.txt',
            '/assets/..%2F..%2Foutside.txt',
            '/%2e%2e/outside.txt',
            '/.env',
            '/assets/%2e%2e/.env',
            '/linked.txt',
            '/a%00b',
        ]) {
            const res = await app.request(path);
            expect([path, res.status]).toEqual([path, 404]);
        }
        expect(await (await app.request('/robots.txt')).text()).toBe('User-agent: *');
    });

    it('answers a matching If-None-Match with 304', async () => {
        const { app } = await setup();
        const page = await app.request('/boards/1');
        const etag = page.headers.get('etag')!;
        expect(etag).toBeTruthy();
        expect((await app.request('/boards/2', { headers: { 'if-none-match': etag } })).status).toBe(304);

        const robots = await app.request('/robots.txt');
        expect(robots.headers.get('cache-control')).toBe('no-cache');
        const robotsTag = robots.headers.get('etag')!;
        expect((await app.request('/robots.txt', { headers: { 'if-none-match': robotsTag } })).status).toBe(304);
    });

    it('answers HEAD without a body', async () => {
        const { app } = await setup();
        const res = await app.request('/boards/1', { method: 'HEAD' });
        expect(res.status).toBe(200);
        expect(await res.text()).toBe('');
    });

    it('escapes the config so a value cannot close the script', async () => {
        const { app } = await setup({ config: { name: '</script><script>alert(1)</script>', sep: '\u2028' } });
        const body = await (await app.request('/')).text();
        expect(body).not.toContain('</script><script>alert(1)');
        expect(body).toContain('\\u003c/script\\u003e');
        expect(JSON.parse(scriptSafeJson({ name: '</script>&', sep: '\u2028' }))).toEqual({
            name: '</script>&',
            sep: '\u2028',
        });
    });

    it('keeps $ patterns in config values as they are, in the page and in the hash', async () => {
        const config = { a: "$& $` $' $$ $1 $<x>" };
        for (const root of [dist, join(base, 'marked-dollars')]) {
            if (root !== dist) {
                mkdirSync(root, { recursive: true });
                writeFileSync(join(root, 'index.html'), '<html><head><!--app-config--></head></html>');
            }
            const { app, spa } = await setup({ root, config });
            const script = `window.__APP_CONFIG__=${scriptSafeJson(config)};`;
            const body = await (await app.request('/')).text();
            expect(body).toContain(`<script>${script}</script>`);
            expect(spa.configScriptHash).toBe(`'sha256-${createHash('sha256').update(script).digest('base64')}'`);
        }
    });

    it("hands the config script's hash to the page's Content-Security-Policy", async () => {
        const { app, spa } = await setup({
            config: { env: 'prod' },
            contentSecurityPolicy: (hash) => `default-src 'self'; script-src 'self' ${hash}`,
        });
        const script = 'window.__APP_CONFIG__={"env":"prod"};';
        const hash = `'sha256-${createHash('sha256').update(script).digest('base64')}'`;
        expect(spa.configScriptHash).toBe(hash);
        const res = await app.request('/');
        expect(res.headers.get('content-security-policy')).toBe(`default-src 'self'; script-src 'self' ${hash}`);
    });

    it('puts the config at the <!--app-config--> marker when the page has one', async () => {
        const marked = join(base, 'marked');
        mkdirSync(marked);
        writeFileSync(join(marked, 'index.html'), '<html><head><!--app-config--><title>x</title></head></html>');
        const { app } = await setup({ root: marked, config: { a: 1 } });
        expect(await (await app.request('/')).text()).toBe(
            '<html><head><script>window.__APP_CONFIG__={"a":1};</script><title>x</title></head></html>',
        );
    });

    it('refuses to start in production without the built page, and serves nothing in development', async () => {
        process.env.NODE_ENV = 'production';
        await expect(setup({ root: join(base, 'missing') })).rejects.toThrow('build the client app');

        process.env.NODE_ENV = 'development';
        const { app, warnings } = await setup({ root: join(base, 'missing') });
        expect(warnings.some((w) => w.includes('serving no client app'))).toBe(true);
        expect((await app.request('/boards/1', { headers: html })).status).toBe(404);
    });
});

describe('Kernel.setFallback', () => {
    it('answers what no route takes, falls back to the 404, and is set once before initialize', async () => {
        const kernel = new Kernel({ logger: false });
        kernel.setFallback((c) => (c.req.path === '/known' ? c.text('from fallback') : undefined));
        expect(() => kernel.setFallback(() => undefined)).toThrow('already set');
        await kernel.initialize();
        expect(() => kernel.setFallback(() => undefined)).toThrow('after initialization');

        const app = kernel.getApp();
        expect(await (await app.request('/known')).text()).toBe('from fallback');
        const missing = await app.request('/unknown');
        expect(missing.status).toBe(404);
        expect(((await missing.json()) as { code: string }).code).toBe('NOT_FOUND');
    });
});
