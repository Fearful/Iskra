import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Kernel } from '@iskra-bun/web-kit';
import { config } from '../src/app.config.ts';
import staticRoutes, { FORM_PAGE_CSP } from '../src/interfaces/http/static.routes.ts';

const staticDir = mkdtempSync(join(tmpdir(), 'forms-api-static-'));
const configuredStaticDir = config.staticDir;
let kernel: Kernel;

beforeAll(async () => {
    mkdirSync(join(staticDir, 'demo', 'encuesta'), { recursive: true });
    writeFileSync(join(staticDir, 'demo', 'encuesta', 'index.html'), '<!DOCTYPE html><title>Encuesta</title>');
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
    rmSync(staticDir, { recursive: true, force: true });
});

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
