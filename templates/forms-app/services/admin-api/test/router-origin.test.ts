import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import router from '../src/interfaces/http/router.ts';
import { config } from '../src/app.config.ts';

// The admin routes check the Origin of state-changing requests themselves:
// better-auth's trustedOrigins only covers its own routes under /api/auth.
const ALLOWED = config.cors.origins.split(',')[0];
const FOREIGN = 'http://evil.example';

/** The router under /api, as in main.ts, with or without a signed-in user. */
function api(signedIn: boolean) {
    const app = new Hono();
    app.use('*', async (c, next) => {
        if (signedIn) c.set('user' as never, { id: 'admin' } as never);
        await next();
    });
    app.route('/api', router);
    return app;
}

const send = (app: Hono, method: string, path: string, headers: Record<string, string>) =>
    app.request(path, {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
        body: method === 'GET' ? undefined : '{}',
    });

describe('admin-api Origin check', () => {
    it('rejects POST and DELETE from a foreign origin, even with a session', async () => {
        const app = api(true);
        expect((await send(app, 'POST', '/api/spaces', { Origin: FOREIGN })).status).toBe(403);
        expect((await send(app, 'POST', '/api/forms/f1/publish', { Origin: FOREIGN })).status).toBe(403);
        expect((await send(app, 'DELETE', '/api/forms/f1', { Origin: FOREIGN })).status).toBe(403);
        expect((await send(app, 'POST', '/api/spaces', { Origin: 'null' })).status).toBe(403);
    });

    it('rejects cross-site and same-site requests without an Origin', async () => {
        const app = api(true);
        for (const site of ['cross-site', 'same-site']) {
            expect((await send(app, 'DELETE', '/api/forms/f1', { 'Sec-Fetch-Site': site })).status).toBe(403);
        }
    });

    it('lets an allowed origin through to the session check', async () => {
        const app = api(false);
        expect((await send(app, 'POST', '/api/spaces', { Origin: ALLOWED })).status).toBe(401);
        expect((await send(app, 'DELETE', '/api/forms/f1', { Origin: ALLOWED })).status).toBe(401);
        // Non-browser clients (no Origin, no Sec-Fetch-Site) and same-origin fetches too.
        expect((await send(app, 'POST', '/api/spaces', {})).status).toBe(401);
        expect((await send(app, 'POST', '/api/spaces', { 'Sec-Fetch-Site': 'same-origin' })).status).toBe(401);
    });

    it('does not check GET', async () => {
        expect((await send(api(false), 'GET', '/api/spaces', { Origin: FOREIGN })).status).toBe(401);
    });
});
