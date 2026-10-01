import { afterAll, afterEach, describe, expect, it } from 'bun:test';
import { AuthFeature, getAccessToken } from '../src/features/auth/index';
import { DbFeature } from '../src/features/db';
import { Kernel } from '../src/kernel';

// Real better-auth on in-memory sqlite, signing in through a fake GitLab.

const DDL = `
CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT, email TEXT NOT NULL UNIQUE, emailVerified INTEGER NOT NULL, image TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
CREATE TABLE session (id TEXT PRIMARY KEY, expiresAt INTEGER NOT NULL, token TEXT NOT NULL UNIQUE, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, ipAddress TEXT, userAgent TEXT, userId TEXT NOT NULL REFERENCES user(id));
CREATE TABLE account (id TEXT PRIMARY KEY, accountId TEXT NOT NULL, providerId TEXT NOT NULL, userId TEXT NOT NULL REFERENCES user(id), accessToken TEXT, refreshToken TEXT, idToken TEXT, accessTokenExpiresAt INTEGER, refreshTokenExpiresAt INTEGER, scope TEXT, password TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
CREATE TABLE verification (id TEXT PRIMARY KEY, identifier TEXT NOT NULL, value TEXT NOT NULL, expiresAt INTEGER NOT NULL, createdAt INTEGER, updatedAt INTEGER);
`;
const SECRET = 'a-contract-secret-with-enough-entropy-1f9c2e7b';
const ORIGIN = 'http://localhost:3000';

let refreshStatus = 200;
let issued = 0;
const gitlab = Bun.serve({
    port: 0,
    async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === '/oauth/token') {
            const grant = new URLSearchParams(await req.text()).get('grant_type');
            if (grant === 'refresh_token' && refreshStatus !== 200) {
                return refreshStatus === 400
                    ? Response.json({ error: 'invalid_grant' }, { status: 400 })
                    : new Response('unavailable', { status: refreshStatus });
            }
            const n = ++issued;
            return Response.json({ access_token: `access-${n}`, refresh_token: `refresh-${n}`, expires_in: 7200 });
        }
        if (url.pathname === '/api/v4/user') {
            return Response.json({ id: 7, username: 'dev', email: 'dev@example.com', state: 'active' });
        }
        return new Response(null, { status: 404 });
    },
});
afterAll(() => gitlab.stop(true));

const savedEnv = process.env.NODE_ENV;
afterEach(() => {
    if (savedEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedEnv;
    refreshStatus = 200;
});

const cookies = (res: Response) =>
    res.headers
        .getSetCookie()
        .map((c) => c.split(';')[0])
        .join('; ');

async function setup() {
    process.env.NODE_ENV = 'development';
    const kernel = new Kernel({ logger: false });
    const db = new DbFeature({ adapter: 'sqlite', connection: { database: ':memory:' } });
    kernel.registerFeature(db);
    kernel.registerFeature(
        new AuthFeature({
            secret: SECRET,
            baseURL: ORIGIN,
            rateLimit: false,
            socialProviders: {
                gitlab: { clientId: 'id', clientSecret: 'secret', issuer: `http://localhost:${gitlab.port}` },
            },
        }),
    );
    await kernel.initialize();
    const sqlite = (db.db as unknown as { $client: { exec(sql: string): void; run(sql: string, p: unknown[]): void } })
        .$client;
    sqlite.exec(DDL);

    const app = kernel.getApp();
    app.get('/projects', async (c) => c.json({ token: (await getAccessToken(c, 'gitlab')).accessToken }));

    const start = await app.request('/api/sso/sign-in/social', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ provider: 'gitlab', callbackURL: '/' }),
    });
    const state = new URL(((await start.json()) as { url: string }).url).searchParams.get('state');
    const callback = await app.request(`/api/sso/callback/gitlab?code=c&state=${state}`, {
        headers: { cookie: cookies(start) },
    });
    const expire = () =>
        sqlite.run('UPDATE account SET accessTokenExpiresAt = ?', [Math.floor(Date.now() / 1000) - 10]);
    return { app, cookie: cookies(callback), expire };
}

describe('getAccessToken(c, provider)', () => {
    it("hands out the signed-in user's token, renewed once expired", async () => {
        const { app, cookie, expire } = await setup();
        const first = await app.request('/projects', { headers: { cookie } });
        expect(first.status).toBe(200);
        const firstToken = ((await first.json()) as { token: string }).token;
        expect(firstToken).toStartWith('access-');

        expire();
        const renewed = await app.request('/projects', { headers: { cookie } });
        const renewedToken = ((await renewed.json()) as { token: string }).token;
        expect(renewedToken).toStartWith('access-');
        expect(renewedToken).not.toBe(firstToken);
    });

    it("keeps better-auth's token routes closed to the browser", async () => {
        const { app, cookie } = await setup();
        for (const path of ['get-access-token', 'refresh-token', 'account-info']) {
            const res = await app.request(`/api/sso/${path}`, {
                method: 'POST',
                headers: { cookie, origin: ORIGIN, 'content-type': 'application/json' },
                body: JSON.stringify({ providerId: 'gitlab' }),
            });
            expect([path, res.status]).toEqual([path, 404]);
            expect(await res.text()).not.toContain('access-');
        }
    });

    it('answers 401 without a session', async () => {
        const { app } = await setup();
        const res = await app.request('/projects');
        expect(res.status).toBe(401);
        expect(((await res.json()) as { code: string }).code).toBe('UNAUTHORIZED');
    });

    it('answers 401 OAUTH_REAUTH_REQUIRED when the provider refuses the refresh token', async () => {
        const { app, cookie, expire } = await setup();
        expire();
        refreshStatus = 400;
        const res = await app.request('/projects', { headers: { cookie } });
        expect(res.status).toBe(401);
        const body = (await res.json()) as { code: string; context?: Record<string, unknown> };
        expect(body.code).toBe('OAUTH_REAUTH_REQUIRED');
        expect(body.context).toEqual({ provider: 'gitlab', reason: 'REFRESH_FAILED' });
    });

    it('answers 502 OAUTH_PROVIDER_UNAVAILABLE when the provider is down', async () => {
        const { app, cookie, expire } = await setup();
        expire();
        refreshStatus = 503;
        const res = await app.request('/projects', { headers: { cookie } });
        expect(res.status).toBe(502);
        expect(((await res.json()) as { code: string }).code).toBe('OAUTH_PROVIDER_UNAVAILABLE');
    });
});
