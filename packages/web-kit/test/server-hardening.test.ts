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

describe('WebDriver — request body limit', () => {
    const PORT = 3459;

    async function start(options: { maxRequestBodySize?: number } = {}) {
        const app = new App({ name: 'WebBodyLimitTest' });
        app.register(
            new WebDriver({
                port: PORT,
                ...options,
                routes: [
                    {
                        method: 'POST',
                        path: '/echo',
                        handler: async (ctx) => ({ length: (await ctx.raw.req.text()).length }),
                    },
                ],
            }),
        );
        await app.start();
        return app;
    }

    it('caps bodies at 16 MiB by default, like the Kernel (Bun alone allows 128 MiB)', async () => {
        const app = await start();
        try {
            const ok = await fetch(`http://localhost:${PORT}/echo`, { method: 'POST', body: 'x'.repeat(1024) });
            expect(await ok.json()).toEqual({ length: 1024 });

            const big = await fetch(`http://localhost:${PORT}/echo`, {
                method: 'POST',
                body: new Uint8Array(16 * 1024 * 1024 + 1),
            });
            expect(big.status).toBe(413);
        } finally {
            await app.stop();
        }
    });

    it('takes maxRequestBodySize', async () => {
        const app = await start({ maxRequestBodySize: 1000 });
        try {
            const big = await fetch(`http://localhost:${PORT}/echo`, { method: 'POST', body: 'x'.repeat(2000) });
            expect(big.status).toBe(413);
        } finally {
            await app.stop();
        }
    });
});
