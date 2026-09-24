import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { WebDriver } from '../src/server';
import { App } from '@iskra-bun/core';

// Hardening parity for the standalone WebDriver HTTP stack (src/server.ts).
//
// Mirrors the health-leak hardening: a handler error must never serialize its
// raw message to the client (it can embed connection strings / secrets), and
// the same standard security headers applied elsewhere in web-kit must be set.
const SECRET_MARKER = 'CONNECTION_STRING_postgres://user:p4ss@db:5432/app';

describe('WebDriver — error/header hardening', () => {
    let app: App;
    const PORT = 3458;

    beforeAll(async () => {
        app = new App({ name: 'WebHardeningTest' });
        const driver = new WebDriver({
            port: PORT,
            routes: [
                {
                    method: 'GET',
                    path: '/boom',
                    handler: () => {
                        throw new Error(SECRET_MARKER);
                    },
                },
                {
                    method: 'GET',
                    path: '/ok',
                    handler: () => ({ message: 'world' }),
                },
            ],
        });
        app.register(driver);
        await app.start();
    });

    afterAll(async () => {
        await app.stop();
    });

    it('returns a generic 500 body with no raw error string', async () => {
        const res = await fetch(`http://localhost:${PORT}/boom`);
        expect(res.status).toBe(500);

        const bodyText = await res.text();
        // The raw exception message (and any embedded secret) must not leak.
        expect(bodyText).not.toContain(SECRET_MARKER);
        expect(bodyText).not.toContain('p4ss');
    });

    it('sets standard security headers on responses', async () => {
        const res = await fetch(`http://localhost:${PORT}/ok`);
        expect(res.status).toBe(200);
        expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
        expect(res.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
        // Off, as in the Kernel: the legacy auditor it enables could be abused.
        expect(res.headers.get('X-XSS-Protection')).toBeNull();
        expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    });

    it('sets security headers even on error responses', async () => {
        const res = await fetch(`http://localhost:${PORT}/boom`);
        expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
        expect(res.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
    });
});
