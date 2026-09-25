import { describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFormBundle } from '../src/domain/prerender/prerender.service.ts';
import { generateFormHtml } from '../src/domain/prerender/html-template.ts';
import { generateFormRuntime, publicFormBase } from '../src/domain/prerender/form-runtime.ts';

// The pre-render never produced a working page: the Vite build failed on the
// validation module, and with base "/" the page pointed at /assets/*, which
// nothing serves (forms-api serves /<space>/<form>/assets/* under /formularios).
describe('buildFormBundle', () => {
    it('builds a form page whose assets resolve under its public path', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'form-build-'));
        try {
            const src = join(dir, 'src');
            const out = join(dir, 'out');
            mkdirSync(join(src, 'assets'), { recursive: true });
            const fields = [
                {
                    id: 'f1',
                    formId: 'form-1',
                    fieldType: 'email',
                    label: 'Email',
                    name: 'email',
                    position: 0,
                    required: true,
                    options: null,
                    maxLength: null,
                    min: null,
                    max: null,
                    placeholder: null,
                    helpText: null,
                    errorMessage: null,
                },
            ] as any;
            writeFileSync(join(src, 'index.html'), generateFormHtml('Encuesta', null, fields, 'form-1', 'site-key'));
            writeFileSync(join(src, 'main.ts'), generateFormRuntime('form-1', 'demo', 'encuesta', 'site-key'));
            writeFileSync(join(src, 'assets', 'style.css'), 'body { margin: 0 }');

            await buildFormBundle({
                sourceDir: src,
                outputDir: out,
                formId: 'form-1',
                validationSchema: {
                    type: 'object',
                    properties: { email: { type: 'string', format: 'email' } },
                    required: ['email'],
                },
                base: publicFormBase('demo', 'encuesta'),
            });

            const html = readFileSync(join(out, 'index.html'), 'utf8');
            const script = html.match(/src="(\/formularios\/demo\/encuesta\/assets\/[^"]+\.js)"/)?.[1];
            expect(script).toBeDefined();
            expect(existsSync(join(out, script!.replace('/formularios/demo/encuesta/', '')))).toBe(true);
            expect(html).toMatch(/href="\/formularios\/demo\/encuesta\/assets\/[^"]+\.css"/);

            // forms-api serves the page under a CSP without 'unsafe-inline':
            // no inline script or style, and scripts only from the page's
            // origin or reCAPTCHA.
            expect(html).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/);
            expect(html).not.toMatch(/<style|\sstyle=/);
            const sources = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]);
            expect(sources).toHaveLength(2);
            for (const source of sources) {
                expect(source).toMatch(/^(\/formularios\/|https:\/\/www\.google\.com\/recaptcha\/)/);
            }
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }, 60_000);
});
