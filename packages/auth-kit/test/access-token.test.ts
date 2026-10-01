import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { createBetterAuth, getProviderAccessToken, OAuthTokenError } from '../src';

const SECRET = 'test-secret-at-least-32-chars-long-xyz';
const BASE_URL = 'http://localhost:3000';

const DDL = `
CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT, email TEXT NOT NULL UNIQUE, emailVerified INTEGER NOT NULL,
    image TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
CREATE TABLE session (id TEXT PRIMARY KEY, expiresAt INTEGER NOT NULL, token TEXT NOT NULL UNIQUE,
    createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, ipAddress TEXT, userAgent TEXT,
    userId TEXT NOT NULL REFERENCES user(id));
CREATE TABLE account (id TEXT PRIMARY KEY, accountId TEXT NOT NULL, providerId TEXT NOT NULL,
    userId TEXT NOT NULL REFERENCES user(id), accessToken TEXT, refreshToken TEXT, idToken TEXT,
    accessTokenExpiresAt INTEGER, refreshTokenExpiresAt INTEGER, scope TEXT, password TEXT,
    createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
CREATE TABLE verification (id TEXT PRIMARY KEY, identifier TEXT NOT NULL, value TEXT NOT NULL,
    expiresAt INTEGER NOT NULL, createdAt INTEGER, updatedAt INTEGER);
`;

/**
 * An identity provider that issues 2-hour tokens and rotates the refresh
 * token on every renewal (the old one is refused afterwards), like
 * gitlab.com. It answers as GitLab (`/oauth/token`, `/api/v4/user`) and as
 * an OIDC issuer (discovery, `/oidc/*`), with the same tokens.
 */
const idp = {
    issued: 0,
    refreshes: 0,
    validRefresh: new Set<string>(),
    down: false,
    /** How long a renewal takes (long enough by default for concurrent callers to overlap). */
    refreshDelayMs: 30,
    /** An answer to every renewal instead of the normal one (429, invalid_client…). */
    refreshAnswer: undefined as (() => Response) | undefined,
    /** `expires_in` of the tokens issued; undefined leaves it out. */
    expiresIn: 7200 as number | undefined,
    reset() {
        this.issued = 0;
        this.refreshes = 0;
        this.validRefresh.clear();
        this.down = false;
        this.refreshDelayMs = 30;
        this.refreshAnswer = undefined;
        this.expiresIn = 7200;
    },
    pair() {
        const n = ++this.issued;
        const refresh = `gl-refresh-${n}`;
        this.validRefresh.add(refresh);
        return {
            access_token: `gl-access-${n}`,
            refresh_token: refresh,
            token_type: 'bearer',
            ...(this.expiresIn !== undefined && { expires_in: this.expiresIn }),
        };
    },
    async token(req: Request): Promise<Response> {
        const body = new URLSearchParams(await req.text());
        if (body.get('grant_type') === 'authorization_code') return Response.json(this.pair());
        this.refreshes++;
        if (this.down) return new Response('unavailable', { status: 503 });
        if (this.refreshAnswer) return this.refreshAnswer();
        await Bun.sleep(this.refreshDelayMs);
        const used = body.get('refresh_token')!;
        if (!this.validRefresh.delete(used)) return Response.json({ error: 'invalid_grant' }, { status: 400 });
        return Response.json(this.pair());
    },
};

const fake = Bun.serve({
    port: 0,
    async fetch(req) {
        const url = new URL(req.url);
        const base = `http://localhost:${url.port}`;
        if (url.pathname === '/oauth/token' || url.pathname === '/oidc/token') return idp.token(req);
        if (url.pathname === '/.well-known/openid-configuration') {
            return Response.json({
                issuer: base,
                authorization_endpoint: `${base}/oidc/authorize`,
                token_endpoint: `${base}/oidc/token`,
                userinfo_endpoint: `${base}/oidc/userinfo`,
                jwks_uri: `${base}/oidc/jwks`,
                id_token_signing_alg_values_supported: ['RS256'],
            });
        }
        if (url.pathname === '/oidc/jwks') return Response.json({ keys: [] });
        if (url.pathname === '/oidc/userinfo') {
            return Response.json({ sub: 'user-42', email: 'dev@example.com', email_verified: true, name: 'Dev' });
        }
        if (url.pathname === '/api/v4/user') {
            return Response.json({
                id: 42,
                username: 'dev',
                name: 'Dev',
                email: 'dev@example.com',
                email_verified: true,
                state: 'active',
                avatar_url: null,
            });
        }
        return new Response('not found', { status: 404 });
    },
});
afterAll(() => fake.stop(true));

function buildAuth(sqlite: Database, secret = SECRET) {
    return createBetterAuth({
        db: drizzle(sqlite),
        adapterType: 'sqlite',
        secret,
        baseURL: BASE_URL,
        enableEmailPassword: false,
        rateLimit: false,
        socialProviders: {
            gitlab: { clientId: 'client', clientSecret: 'client-secret', issuer: `http://localhost:${fake.port}` },
        },
    });
}

type TestAuth = ReturnType<typeof buildAuth>;

const cookieHeader = (res: Response) =>
    res.headers
        .getSetCookie()
        .map((c) => c.split(';')[0])
        .join('; ');

/** Signs in through the provider's OAuth flow; returns headers that carry the session. */
async function signIn(auth: TestAuth, provider = 'gitlab'): Promise<Headers> {
    const start = await auth.handler(
        new Request(`${BASE_URL}/api/auth/sign-in/social`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: BASE_URL },
            body: JSON.stringify({ provider, callbackURL: '/' }),
        }),
    );
    const { url } = (await start.json()) as { url: string };
    const state = new URL(url).searchParams.get('state')!;
    const callback = await auth.handler(
        new Request(`${BASE_URL}/api/auth/callback/${provider}?code=the-code&state=${state}`, {
            headers: { cookie: cookieHeader(start) },
        }),
    );
    expect(callback.status).toBe(302);
    return new Headers({ cookie: cookieHeader(callback) });
}

describe('getProviderAccessToken', () => {
    let sqlite: Database;
    let auth: TestAuth;
    let headers: Headers;

    const row = () =>
        sqlite.query("SELECT * FROM account WHERE providerId = 'gitlab'").get() as {
            accessToken: string;
            refreshToken: string;
            userId: string;
        };
    // drizzle stores sqlite timestamps in seconds.
    const expireStoredToken = (inMs = -1000) =>
        sqlite.run("UPDATE account SET accessTokenExpiresAt = ? WHERE providerId = 'gitlab'", [
            Math.floor((Date.now() + inMs) / 1000),
        ]);

    beforeEach(async () => {
        idp.reset();
        sqlite = new Database(':memory:');
        sqlite.exec(DDL);
        auth = buildAuth(sqlite);
        headers = await signIn(auth);
    });

    it('stores the tokens encrypted and hands out the original', async () => {
        const stored = row();
        expect(stored.accessToken).not.toContain('gl-access-1');
        expect(stored.refreshToken).not.toContain('gl-refresh-1');

        const token = await getProviderAccessToken(auth, { headers, providerId: 'gitlab' });
        expect(token.accessToken).toBe('gl-access-1');
        expect(token.accessTokenExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 60 * 60 * 1000);
        expect(idp.refreshes).toBe(0);
    });

    it('renews an expired token by itself and stores the new pair encrypted', async () => {
        expireStoredToken();

        const token = await getProviderAccessToken(auth, { headers, providerId: 'gitlab' });
        expect(token.accessToken).toBe('gl-access-2');
        expect(idp.refreshes).toBe(1);
        expect(row().accessToken).not.toContain('gl-access-2');
        expect(row().refreshToken).not.toContain('gl-refresh-2');

        // The renewed one is served from the database from then on.
        expect((await getProviderAccessToken(auth, { headers, providerId: 'gitlab' })).accessToken).toBe('gl-access-2');
        expect(idp.refreshes).toBe(1);
    });

    it('renews a token that expires within minValidityMs', async () => {
        expireStoredToken(30_000);
        expect((await getProviderAccessToken(auth, { headers, providerId: 'gitlab' })).accessToken).toBe('gl-access-2');
        expireStoredToken(30_000);
        const token = await getProviderAccessToken(auth, { headers, providerId: 'gitlab', minValidityMs: 10_000 });
        expect(token.accessToken).toBe('gl-access-2');
    });

    it('renews once for concurrent callers (the provider rotates refresh tokens)', async () => {
        expireStoredToken();
        const tokens = await Promise.all(
            Array.from({ length: 5 }, () => getProviderAccessToken(auth, { headers, providerId: 'gitlab' })),
        );
        expect(tokens.map((t) => t.accessToken)).toEqual(Array(5).fill('gl-access-2'));
        expect(idp.refreshes).toBe(1);
    });

    it('works without a request, for a user id (background jobs)', async () => {
        expireStoredToken();
        const token = await getProviderAccessToken(auth, { userId: row().userId, providerId: 'gitlab' });
        expect(token.accessToken).toBe('gl-access-2');
    });

    it('asks to sign in again when the provider refuses the refresh token', async () => {
        idp.validRefresh.clear();
        expireStoredToken();
        const error = await getProviderAccessToken(auth, { headers, providerId: 'gitlab' }).catch((e) => e);
        expect(error).toBeInstanceOf(OAuthTokenError);
        expect(error.code).toBe('REFRESH_FAILED');
        expect(error.requiresSignIn).toBe(true);
    });

    it('keeps the stored pair when the provider is down, and renews once it is back', async () => {
        expireStoredToken();
        const before = row();
        idp.down = true;
        const error = await getProviderAccessToken(auth, { headers, providerId: 'gitlab' }).catch((e) => e);
        expect(error.code).toBe('PROVIDER_UNAVAILABLE');
        expect(error.requiresSignIn).toBe(false);
        expect(row().refreshToken).toBe(before.refreshToken);

        idp.down = false;
        expect((await getProviderAccessToken(auth, { headers, providerId: 'gitlab' })).accessToken).toBe('gl-access-2');
    });

    it('refuses a request without a session and a provider the user has not linked', async () => {
        const anonymous = await getProviderAccessToken(auth, { headers: new Headers(), providerId: 'gitlab' }).catch(
            (e) => e,
        );
        expect(anonymous.code).toBe('NOT_SIGNED_IN');
        const unlinked = await getProviderAccessToken(auth, { headers, providerId: 'github' }).catch((e) => e);
        expect(unlinked.code).toBe('ACCOUNT_NOT_LINKED');
    });

    it("closes better-auth's routes that hand the token to the browser or renew it", async () => {
        const { id: accountId } = sqlite.query("SELECT id FROM account WHERE providerId = 'gitlab'").get() as {
            id: string;
        };
        expireStoredToken();
        const paths = [
            '/get-access-token',
            '/refresh-token',
            '/account-info',
            '/get-access-token/',
            '/refresh-token//',
            '//get-access-token',
            '/get%2Daccess-token',
            '/%67et-access-token',
            '/GET-ACCESS-TOKEN',
        ];
        for (const path of paths) {
            for (const method of ['POST', 'GET']) {
                const res = await auth.handler(
                    new Request(`${BASE_URL}/api/auth${path}${method === 'GET' ? `?accountId=${accountId}` : ''}`, {
                        method,
                        headers: {
                            cookie: headers.get('cookie')!,
                            origin: BASE_URL,
                            'content-type': 'application/json',
                        },
                        ...(method === 'POST' && { body: JSON.stringify({ accountId }) }),
                    }),
                );
                const body = await res.text();
                expect([method, path, res.status]).toEqual([method, path, 404]);
                expect(body).not.toContain('gl-access');
            }
        }
        expect(idp.refreshes).toBe(0);
        // The server still gets the token, renewed once.
        expect((await getProviderAccessToken(auth, { headers, providerId: 'gitlab' })).accessToken).toBe('gl-access-2');
    });

    it('keeps the session and the stored pair on a 429 or an invalid_client', async () => {
        const answers = [
            () => Response.json({ error: 'slow_down' }, { status: 429, headers: { 'retry-after': '30' } }),
            () => Response.json({ error: 'invalid_client' }, { status: 401 }),
            () => Response.json({ error: 'server_error' }, { status: 500 }),
        ];
        for (const answer of answers) {
            idp.refreshAnswer = answer;
            expireStoredToken();
            const before = row().refreshToken;
            const error = await getProviderAccessToken(auth, { headers, providerId: 'gitlab' }).catch((e) => e);
            expect(error.code).toBe('PROVIDER_UNAVAILABLE');
            expect(error.requiresSignIn).toBe(false);
            expect(row().refreshToken).toBe(before);
        }
        idp.refreshAnswer = undefined;
        expect((await getProviderAccessToken(auth, { headers, providerId: 'gitlab' })).accessToken).toBe('gl-access-2');
    });

    it('stops waiting after timeoutMs, and stores the answer that comes later', async () => {
        idp.refreshDelayMs = 300;
        expireStoredToken();
        const started = Date.now();
        const error = await getProviderAccessToken(auth, { headers, providerId: 'gitlab', timeoutMs: 40 }).catch(
            (e) => e,
        );
        expect(error.code).toBe('PROVIDER_UNAVAILABLE');
        expect(Date.now() - started).toBeLessThan(250);

        // The next call waits for that renewal instead of sending the
        // refresh token it already used: the provider would refuse it.
        const token = await getProviderAccessToken(auth, { headers, providerId: 'gitlab' });
        expect(token.accessToken).toBe('gl-access-2');
        expect(idp.refreshes).toBe(1);
    });

    it('stores no expiry when the provider gives none, and does not renew it again', async () => {
        idp.expiresIn = undefined;
        expireStoredToken();
        expect((await getProviderAccessToken(auth, { headers, providerId: 'gitlab' })).accessToken).toBe('gl-access-2');
        const stored = sqlite.query("SELECT accessTokenExpiresAt FROM account WHERE providerId = 'gitlab'").get() as {
            accessTokenExpiresAt: number | null;
        };
        expect(stored.accessTokenExpiresAt).toBeNull();
        expect((await getProviderAccessToken(auth, { headers, providerId: 'gitlab' })).accessToken).toBe('gl-access-2');
        expect(idp.refreshes).toBe(1);
    });

    it('cannot read the stored tokens once the secret changes', async () => {
        const rotated = buildAuth(sqlite, 'another-secret-at-least-32-chars-long');
        const error = await getProviderAccessToken(rotated, { userId: row().userId, providerId: 'gitlab' }).catch(
            (e) => e,
        );
        expect(error.code).toBe('TOKEN_UNREADABLE');
    });
});

describe('getProviderAccessToken with oidcConfig', () => {
    let sqlite: Database;
    let auth: TestAuth;
    let headers: Headers;

    const expireStoredToken = () =>
        sqlite.run("UPDATE account SET accessTokenExpiresAt = ? WHERE providerId = 'oidc'", [
            Math.floor(Date.now() / 1000) - 10,
        ]);

    beforeEach(async () => {
        idp.reset();
        sqlite = new Database(':memory:');
        sqlite.exec(DDL);
        auth = createBetterAuth({
            db: drizzle(sqlite),
            adapterType: 'sqlite',
            secret: SECRET,
            baseURL: BASE_URL,
            enableEmailPassword: false,
            rateLimit: false,
            oidcConfig: { clientId: 'client', clientSecret: 'client-secret', issuer: `http://localhost:${fake.port}` },
        }) as TestAuth;
        headers = await signIn(auth, 'oidc');
    });

    it('stores the tokens encrypted and renews them through the issuer', async () => {
        const stored = sqlite.query("SELECT * FROM account WHERE providerId = 'oidc'").get() as {
            accountId: string;
            accessToken: string;
            refreshToken: string;
        };
        expect(stored.accountId).toBe('user-42');
        expect(stored.accessToken).not.toContain('gl-access-1');
        expect(stored.refreshToken).not.toContain('gl-refresh-1');
        expect((await getProviderAccessToken(auth, { headers, providerId: 'oidc' })).accessToken).toBe('gl-access-1');

        expireStoredToken();
        const renewed = await Promise.all([
            getProviderAccessToken(auth, { headers, providerId: 'oidc' }),
            getProviderAccessToken(auth, { headers, providerId: 'oidc' }),
        ]);
        expect(renewed.map((t) => t.accessToken)).toEqual(['gl-access-2', 'gl-access-2']);
        expect(idp.refreshes).toBe(1);
    });

    it('asks to sign in again only on invalid_grant', async () => {
        expireStoredToken();
        idp.refreshAnswer = () => Response.json({ error: 'temporarily_unavailable' }, { status: 503 });
        expect((await getProviderAccessToken(auth, { headers, providerId: 'oidc' }).catch((e) => e)).code).toBe(
            'PROVIDER_UNAVAILABLE',
        );
        idp.refreshAnswer = undefined;
        idp.validRefresh.clear();
        const error = await getProviderAccessToken(auth, { headers, providerId: 'oidc' }).catch((e) => e);
        expect(error.code).toBe('REFRESH_FAILED');
        expect(error.requiresSignIn).toBe(true);
    });
});
