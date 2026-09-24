import { describe, expect, it } from 'bun:test';
import { escapeHtml, generateFormHtml } from '../src/domain/prerender/html-template.ts';
import { generateFormRuntime } from '../src/domain/prerender/form-runtime.ts';

// Form pages are public: admin-defined text must render as text.
const XSS = '<img src=x onerror=alert(1)>"\'&';
const field = (overrides: Record<string, unknown>) => ({
    id: 'f', formId: 'form-1', fieldType: 'text', label: XSS, name: 'nombre', position: 0, required: true,
    options: null, maxLength: null, min: null, max: null, placeholder: XSS, helpText: XSS, errorMessage: null,
    ...overrides,
}) as any;

describe('prerendered form HTML', () => {
    it('escapes every admin-defined value', () => {
        const html = generateFormHtml(XSS, XSS, [
            field({}),
            field({ name: 'color', fieldType: 'select', options: [{ label: XSS, value: '"><script>alert(1)</script>' }] }),
            field({ name: 'size', fieldType: 'radio', options: [{ label: XSS, value: XSS }] }),
            field({ name: 'tags', fieldType: 'checkbox', options: [{ label: XSS, value: XSS }] }),
            field({ name: 'ok', fieldType: 'checkbox', options: null }),
        ], 'form-1', 'key"><script>');
        expect(html).not.toContain('<img');
        expect(html).not.toContain('<script>alert');
        expect(html).not.toContain('key"><script>');
        expect(html).toContain(escapeHtml(XSS));
        expect(html).toContain('<title>&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;</title>');
    });
});

describe('form runtime', () => {
    it('emits values as JS string literals', () => {
        const code = generateFormRuntime("f'); alert(1); ('", "space'", 'form"', "key'); alert(2); ('");
        // Parses as a module, and the values only appear inside literals.
        expect(() => new Bun.Transpiler({ loader: 'js' }).transformSync(code)).not.toThrow();
        const literals = [
            JSON.stringify("virtual:form-validation/f'); alert(1); ('"),
            JSON.stringify("form-f'); alert(1); ('"),
            JSON.stringify("key'); alert(2); ('"),
            JSON.stringify(`/formularios/api/submit/${encodeURIComponent("space'")}/${encodeURIComponent('form"')}`),
        ];
        for (const literal of literals) expect(code).toContain(literal);
        const outside = literals.reduce((rest, literal) => rest.split(literal).join('""'), code);
        expect(outside).not.toContain('alert(');
    });
});
