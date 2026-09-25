import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Kernel } from '@iskra-bun/web-kit';
import { config } from '../src/app.config.ts';
import staticRoutes, { FORM_PAGE_CSP } from '../src/interfaces/http/static.routes.ts';

// <root>/static is the static directory; <root>/outside and <root>/elsewhere
// hold files next to it that must not be served.
const root = mkdtempSync(join(tmpdir(), 'forms-api-static-'));
const staticDir = join(root, 'static');
const configuredStaticDir = config.staticDir;
let kernel: Kernel;

beforeAll(async () => {
    mkdirSync(join(staticDir, 'demo', 'encuesta', 'assets'), { recursive: true });
    writeFileSync(join(staticDir, 'demo', 'encuesta', 'index.html'), '<!DOCTYPE html><title>Encuesta</title>');
    writeFileSync(join(staticDir, 'demo', 'encuesta', 'assets', 'index-B0tE_a12.js'), 'console.log(1)');
    mkdirSync(join(root, 'outside'));
    writeFileSync(join(root, 'outside', 'index.html'), 'OUTSIDE');
    mkdirSync(join(root, 'elsewhere', 'assets'), { recursive: true });
    writeFileSync(join(root, 'elsewhere', 'assets', 'secret.txt'), 'SECRET');
    config.staticDir = staticDir;

    // Behind the Kernel, as in src/main.ts: its security headers must not
    // replace the page's.
    kernel = new Kernel({ logger: false });
    await kernel.initialize();
    kernel.getApp().route('/', staticRoutes);
});

afterAll(async () => {
    config.staticDir = configuredStaticDir;
    await kernel.shutdown();
    rmSync(root, { recursive: true, force: true });
});

/** The status and body of a GET sent with this exact path: fetch() would normalize it. */
async function rawGet(port: number, path: string): Promise<{ status: number; body: string }> {
    const response = await new Promise<string>((resolve, reject) => {
        let data = '';
        const socket = connect(port, '127.0.0.1', () => {
            socket.write(`GET ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`);
        });
        socket.on('data', (chunk) => (data += chunk));
        socket.on('end', () => resolve(data));
        socket.on('error', reject);
    });
    const [head, ...body] = response.split('\r\n\r\n');
    return { status: Number(head.split(' ')[1]), body: body.join('\r\n\r\n') };
}

describe('form pages', () => {
    it('are served with a Content-Security-Policy', async () => {
        // They had none.
        const res = await kernel.getApp().request('/demo/encuesta');
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
        expect(res.headers.get('Content-Security-Policy')).toBe(FORM_PAGE_CSP);
        expect(res.headers.get('X-Frame-Options')).toBe('DENY');
        expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    });

    it('allow no inline script or style, no framing, and only the sources reCAPTCHA needs', () => {
        const directives = new Map(
            FORM_PAGE_CSP.split('; ').map((d) => [d.split(' ')[0], d.split(' ').slice(1)] as const),
        );
        expect(directives.get('default-src')).toEqual(["'none'"]);
        expect(directives.get('frame-ancestors')).toEqual(["'none'"]);
        expect(directives.get('base-uri')).toEqual(["'none'"]);
        expect(directives.get('script-src')).toEqual([
            "'self'",
            'https://www.google.com/recaptcha/',
            'https://www.gstatic.com/recaptcha/',
        ]);
        expect(directives.get('style-src')).toEqual(["'self'"]);
        expect(directives.get('connect-src')).toEqual(["'self'", 'https://www.google.com/recaptcha/']);
        expect(FORM_PAGE_CSP).not.toContain('unsafe-');
    });
});

describe('static files', () => {
    it('serves a form page and its assets', async () => {
        expect((await kernel.getApp().request('/demo/encuesta')).status).toBe(200);
        expect((await kernel.getApp().request('/demo/encuesta/assets/index-B0tE_a12.js')).status).toBe(200);
    });

    it('serves nothing outside the static directory', async () => {
        // Slugs with an encoded slash used to leave the static directory.
        const server = Bun.serve({ port: 0, fetch: (req) => kernel.getApp().fetch(req) });
        try {
            for (const path of [
                '/..%2F/outside',
                '/..%2F..%2Fstatic/..%2Foutside',
                '/demo/..%2F..%2Felsewhere/assets/secret.txt',
                '/demo/encuesta/assets/..%2F..%2F..%2Felsewhere%2Fassets%2Fsecret.txt',
                '/demo/encuesta/assets/../../../elsewhere/assets/secret.txt',
            ]) {
                const { status, body } = await rawGet(server.port!, path);
                expect({ path, status }).toEqual({ path, status: 404 });
                expect(body).not.toContain('OUTSIDE');
                expect(body).not.toContain('SECRET');
            }
        } finally {
            server.stop(true);
        }
    });
});
