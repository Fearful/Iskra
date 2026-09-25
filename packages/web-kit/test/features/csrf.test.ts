import { describe, it, expect, spyOn, beforeAll, afterAll } from 'bun:test';
import { Hono } from 'hono';
import { Kernel } from '../../src/kernel';
import { CsrfFeature, requireCsrf } from '../../src/features/csrf';
import { SessionFeature } from '../../src/features/session';
import type { CsrfConfig } from '../../src/types';

const SECRET = 'csrf-test-secret-0123456789abcdef0123';
const SESSION_SECRET = 'sess-secret-0123456789abcdef0123456789abcdef';

// Issue a real CSRF cookie+token by hitting a safe route, then return both the
// signed token and the cookie header to replay on an unsafe request.
async function issueToken(app: any, headers: Record<string, string> = {}) {
    const res = await app.request('/safe', { headers });
    const body = (await res.json()) as { token: string };
    const setCookie = res.headers.get('set-cookie') || '';
    // Extract just the `__Host-csrf=...` pair for replay as a request cookie.
    const cookie = setCookie.split(';')[0];
    return { token: body.token, cookie };
}

// Merge all Set-Cookie name=value pairs into one Cookie header for replay.
function cookiesFromResponse(res: Response): string {
    return res.headers
        .getSetCookie()
        .map((c) => c.split(';')[0].trim())
        .join('; ');
}

// CsrfFeature wires middleware onto the kernel's Hono app. We drive it through
// app.request() to verify cookie issuance, safe-method passthrough, and
// header/body token validation. console.log is silenced during init.

let logSpy: ReturnType<typeof spyOn>;
beforeAll(() => {
    logSpy = spyOn(console, 'log').mockImplementation(() => {});
});
afterAll(() => {
    logSpy.mockRestore();
});

async function appWithCsrf(config: CsrfConfig = { secret: SECRET }) {
    const kernel = new Kernel();
    const feature = new CsrfFeature(config);
    kernel.registerFeature(feature);
    await kernel.initialize();
    const app = kernel.getApp();
    app.get('/safe', (c) => c.json({ token: c.get('csrfToken') }));
    app.post('/mutate', (c) => c.json({ ok: true }));
    return app;
}

describe('CsrfFeature construction', () => {
    it('throws when no secret is provided', () => {
        expect(() => new CsrfFeature({} as any)).toThrow(/at least 32 characters; received 0/);
    });

    it('throws when the secret is shorter than 32 characters', () => {
        // Regression: examples passed "csrf-secret", short enough to brute-force
        // offline from a single token.
        expect(() => new CsrfFeature({ secret: 'csrf-secret' })).toThrow(/at least 32 characters; received 11/);
    });

    it('constructs with a long enough secret', () => {
        expect(new CsrfFeature({ secret: SECRET }).name).toBe('csrf');
    });

    it('rejects an invalid trusted origin', () => {
        expect(() => new CsrfFeature({ secret: SECRET, trustedOrigins: ['not an origin'] })).toThrow(
            /invalid origin "not an origin"/,
        );
    });
});

describe('CsrfFeature middleware', () => {
    it('issues a CSRF cookie on a safe (GET) request and exposes the token', async () => {
        const app = await appWithCsrf();
        const res = await app.request('/safe');
        expect(res.status).toBe(200);
        const setCookie = res.headers.get('set-cookie') || '';
        expect(setCookie).toContain('__Host-csrf=');
        const body = (await res.json()) as { token: string };
        expect(typeof body.token).toBe('string');
        expect(body.token.length).toBeGreaterThan(0);
    });

    it('rejects an unsafe (POST) request with no matching token (403)', async () => {
        const app = await appWithCsrf();
        const res = await app.request('/mutate', { method: 'POST' });
        expect(res.status).toBe(403);
    });

    it('allows an unsafe request when the header token matches the issued cookie', async () => {
        const app = await appWithCsrf();
        // Obtain a properly signed token+cookie from a safe request, then replay.
        const { token, cookie } = await issueToken(app);
        const res = await app.request('/mutate', {
            method: 'POST',
            headers: {
                cookie,
                'X-CSRF-Token': token,
            },
        });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });
    });

    it('rejects an unsafe request when the header token does not match', async () => {
        const app = await appWithCsrf();
        const { cookie } = await issueToken(app);
        const res = await app.request('/mutate', {
            method: 'POST',
            headers: {
                cookie,
                'X-CSRF-Token': 'wrongtoken',
            },
        });
        expect(res.status).toBe(403);
    });

    it('accepts a matching token supplied in a urlencoded body field', async () => {
        const app = await appWithCsrf();
        const { token, cookie } = await issueToken(app);
        const res = await app.request('/mutate', {
            method: 'POST',
            headers: {
                cookie,
                'content-type': 'application/x-www-form-urlencoded',
            },
            body: `_csrf=${encodeURIComponent(token)}`,
        });
        expect(res.status).toBe(200);
    });

    it('honors a custom header name and ignoreMethods config', async () => {
        const app = await appWithCsrf({
            secret: SECRET,
            headerName: 'X-My-Csrf',
            ignoreMethods: ['GET', 'HEAD', 'OPTIONS', 'DELETE'],
        });
        app.delete('/mutate2', (c) => c.json({ deleted: true }));
        // DELETE is now an ignored method -> passes without a token.
        const res = await app.request('/mutate2', { method: 'DELETE' });
        expect(res.status).toBe(200);
    });
});

describe('CsrfFeature cookie name', () => {
    const cookieName = async (config: CsrfConfig) =>
        ((await (await appWithCsrf(config)).request('/safe')).headers.get('set-cookie') || '').split('=')[0];

    it('is a __Host- cookie while Secure, so a sibling subdomain cannot set it', async () => {
        // Regression: `_csrf` could be set by any subdomain for the parent
        // domain (Domain=example.com), with a token the attacker knows.
        expect(await cookieName({ secret: SECRET })).toBe('__Host-csrf');
    });

    it('keeps `_csrf` when the cookie is not Secure, and any name that is configured', async () => {
        expect(await cookieName({ secret: SECRET, cookieOptions: { secure: false } })).toBe('_csrf');
        expect(await cookieName({ secret: SECRET, cookieName: 'xsrf' })).toBe('xsrf');
    });
});

describe('CsrfFeature origin check', () => {
    async function post(app: any, headers: Record<string, string>) {
        const { token, cookie } = await issueToken(app);
        return (
            await app.request('/mutate', { method: 'POST', headers: { cookie, 'X-CSRF-Token': token, ...headers } })
        ).status;
    }

    it('rejects a valid token sent from another origin', async () => {
        // Regression: a sibling subdomain that planted its own token in the
        // cookie could submit it; SameSite=Strict does not stop a same-site request.
        const app = await appWithCsrf();
        expect(await post(app, { origin: 'https://evil.example.com', 'sec-fetch-site': 'same-site' })).toBe(403);
        expect(await post(app, { origin: 'null' })).toBe(403);
    });

    it('rejects a cross-site request without Origin', async () => {
        const app = await appWithCsrf();
        expect(await post(app, { 'sec-fetch-site': 'cross-site' })).toBe(403);
    });

    it('accepts its own origin, a trusted one, and clients that send neither header', async () => {
        const app = await appWithCsrf({ secret: SECRET, trustedOrigins: ['https://admin.example.com/'] });
        expect(await post(app, { origin: 'http://localhost' })).toBe(200);
        expect(await post(app, { origin: 'https://admin.example.com', 'sec-fetch-site': 'same-site' })).toBe(200);
        expect(await post(app, {})).toBe(200);
        expect(await post(app, { 'sec-fetch-site': 'same-site' })).toBe(200);
    });

    it("trusts the browser's same-origin verdict behind a proxy that changes the URL", async () => {
        // Behind a TLS-terminating proxy the app sees http:// while the page is https://.
        const app = await appWithCsrf();
        expect(await post(app, { origin: 'https://localhost', 'sec-fetch-site': 'same-origin' })).toBe(200);
    });

    it('applies to requireCsrf() too', async () => {
        const app = await appWithCsrf();
        app.get('/state-changing-get', requireCsrf(), (c) => c.json({ ok: true }));
        const { token, cookie } = await issueToken(app);
        const headers = { cookie, 'X-CSRF-Token': token };
        expect((await app.request('/state-changing-get', { headers })).status).toBe(200);
        const crossSite = { ...headers, 'sec-fetch-site': 'cross-site' };
        expect((await app.request('/state-changing-get', { headers: crossSite })).status).toBe(403);
    });
});

describe('CsrfFeature token signing', () => {
    it('rejects a foreign token minted with a different secret', async () => {
        // A token issued under one secret must not validate under another. This
        // is the core of signed double-submit: forging requires the secret.
        const issuer = await appWithCsrf({ secret: 'secret-A'.repeat(4) });
        const { token, cookie } = await issueToken(issuer);

        const victim = await appWithCsrf({ secret: 'secret-B'.repeat(4) });
        const res = await victim.request('/mutate', {
            method: 'POST',
            headers: { cookie, 'X-CSRF-Token': token },
        });
        expect(res.status).toBe(403);
    });

    it('rejects a tampered token whose signature no longer matches', async () => {
        const app = await appWithCsrf();
        const { token, cookie } = await issueToken(app);
        // Flip the first character of the random half; the signature is now stale.
        const flipped = (token[0] === 'a' ? 'b' : 'a') + token.slice(1);
        const tamperedCookie = cookie.replace(token, flipped);
        const res = await app.request('/mutate', {
            method: 'POST',
            headers: { cookie: tamperedCookie, 'X-CSRF-Token': flipped },
        });
        expect(res.status).toBe(403);
    });

    it('rejects an unsigned plain-UUID token (the pre-fix format)', async () => {
        const app = await appWithCsrf();
        const plain = crypto.randomUUID().replace(/-/g, '');
        const res = await app.request('/mutate', {
            method: 'POST',
            headers: { cookie: `__Host-csrf=${plain}`, 'X-CSRF-Token': plain },
        });
        expect(res.status).toBe(403);
    });

    it('accepts a correctly signed token', async () => {
        const app = await appWithCsrf();
        const { token, cookie } = await issueToken(app);
        const res = await app.request('/mutate', {
            method: 'POST',
            headers: { cookie, 'X-CSRF-Token': token },
        });
        expect(res.status).toBe(200);
    });

    it('rejects a wrong-length token without throwing (constant-time path is safe)', async () => {
        // timingSafeEqual throws on length mismatch; the middleware must guard it
        // and return 403 rather than a 500. A short token exercises that guard.
        const app = await appWithCsrf();
        const { cookie } = await issueToken(app);
        const res = await app.request('/mutate', {
            method: 'POST',
            headers: { cookie, 'X-CSRF-Token': 'short' },
        });
        expect(res.status).toBe(403);
    });
});

describe('CsrfFeature with SessionFeature', () => {
    async function appWithSessionAndCsrf(order: 'session-first' | 'csrf-first' = 'session-first') {
        const kernel = new Kernel();
        const session = new SessionFeature({ store: 'memory', secret: SESSION_SECRET });
        const csrf = new CsrfFeature({ secret: SECRET, cookieOptions: { secure: false } });
        for (const feature of order === 'session-first' ? [session, csrf] : [csrf, session]) {
            kernel.registerFeature(feature);
        }
        await kernel.initialize();
        const app = kernel.getApp();
        app.get('/safe', (c) => c.json({ token: c.get('csrfToken') }));
        app.post('/mutate', (c) => c.json({ ok: true }));
        app.post('/login', async (c) => {
            if (c.req.query('regenerate')) await c.get('regenerateSession')();
            c.get('session').userId = c.req.query('user') ?? 'victim';
            return c.json({ token: c.get('csrfToken') });
        });
        return app;
    }

    /** Signs in as `user`: the session cookie and a CSRF token for that session. */
    async function signIn(app: Hono, user: string) {
        const anonymous = await app.request('/safe');
        const { token } = (await anonymous.json()) as { token: string };
        const login = await app.request(`/login?user=${user}`, {
            method: 'POST',
            headers: { cookie: cookiesFromResponse(anonymous), 'X-CSRF-Token': token },
        });
        expect(login.status).toBe(200);
        const sid = cookiesFromResponse(login)
            .split('; ')
            .find((c) => c.startsWith('sid='))!;
        const page = await app.request('/safe', { headers: { cookie: sid } });
        const own = (await page.json()) as { token: string };
        return { sid, token: own.token, csrfCookie: cookiesFromResponse(page) };
    }

    it('accepts the first POST of a fresh (anonymous) flow', async () => {
        // Anonymous flows mint a throwaway session ID per request: their tokens
        // are not bound to it, or the first POST would 403.
        const app = await appWithSessionAndCsrf();

        const res1 = await app.request('/safe');
        expect(res1.status).toBe(200);
        const { token } = (await res1.json()) as { token: string };
        const cookies = cookiesFromResponse(res1);
        expect(cookies).toContain('_csrf=');

        const res2 = await app.request('/mutate', {
            method: 'POST',
            headers: { cookie: cookies, 'X-CSRF-Token': token },
        });
        expect(res2.status).toBe(200);
        expect(await res2.json()).toEqual({ ok: true });
    });

    it("accepts the logged-in user's own token", async () => {
        const app = await appWithSessionAndCsrf();
        const victim = await signIn(app, 'victim');
        const res = await app.request('/mutate', {
            method: 'POST',
            headers: { cookie: `${victim.sid}; ${victim.csrfCookie}`, 'X-CSRF-Token': victim.token },
        });
        expect(res.status).toBe(200);
    });

    it("rejects a token planted in a logged-in user's cookie, anonymous or another session's", async () => {
        // Regression: tokens were valid for anyone, so an attacker able to set
        // the cookie (a sibling subdomain) submitted a token of their own
        // along with the victim's session cookie.
        const app = await appWithSessionAndCsrf();
        const victim = await signIn(app, 'victim');

        const anonymous = await issueToken(app);
        const attacker = await signIn(app, 'attacker');
        for (const planted of [
            { cookie: anonymous.cookie, token: anonymous.token },
            { cookie: attacker.csrfCookie, token: attacker.token },
        ]) {
            const res = await app.request('/mutate', {
                method: 'POST',
                headers: { cookie: `${victim.sid}; ${planted.cookie}`, 'X-CSRF-Token': planted.token },
            });
            expect(res.status).toBe(403);
        }
    });

    it('issues a new token with regenerateSession() and stops accepting the old one', async () => {
        const app = await appWithSessionAndCsrf();
        const anonymous = await app.request('/safe');
        const { token: before } = (await anonymous.json()) as { token: string };

        const login = await app.request('/login?regenerate=1', {
            method: 'POST',
            headers: { cookie: cookiesFromResponse(anonymous), 'X-CSRF-Token': before },
        });
        const { token: after } = (await login.json()) as { token: string };
        expect(after).not.toBe(before);
        const cookie = cookiesFromResponse(login);

        const mutate = (token: string) =>
            app.request('/mutate', { method: 'POST', headers: { cookie, 'X-CSRF-Token': token } });
        expect((await mutate(after)).status).toBe(200);
        expect((await mutate(before)).status).toBe(403);
    });

    it('binds tokens to the session whatever the order the features were registered in', async () => {
        const app = await appWithSessionAndCsrf('csrf-first');
        const victim = await signIn(app, 'victim');
        const anonymous = await issueToken(app);
        const res = await app.request('/mutate', {
            method: 'POST',
            headers: { cookie: `${victim.sid}; ${anonymous.cookie}`, 'X-CSRF-Token': anonymous.token },
        });
        expect(res.status).toBe(403);
    });
});

describe('requireCsrf middleware', () => {
    it('throws 403 when CsrfFeature is not registered', async () => {
        const app = new Hono();
        app.post('/guarded', requireCsrf(), (c) => c.json({ ok: true }));
        const res = await app.request('/guarded', { method: 'POST' });
        expect(res.status).toBe(403);
    });

    it('validates the token even on a method the middleware ignores', async () => {
        // Regression: requireCsrf only checked that a token was on the context,
        // which the middleware always sets, so it guarded nothing.
        const app = await appWithCsrf();
        app.get('/state-changing-get', requireCsrf(), (c) => c.json({ ok: true }));
        const { token, cookie } = await issueToken(app);

        expect((await app.request('/state-changing-get', { headers: { cookie } })).status).toBe(403);
        const ok = await app.request('/state-changing-get', { headers: { cookie, 'X-CSRF-Token': token } });
        expect(ok.status).toBe(200);
    });
});
