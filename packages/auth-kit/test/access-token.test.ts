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
 * A GitLab that issues 2-hour tokens and rotates the refresh token on every
 * renewal (the old one is refused afterwards), like gitlab.com.
 */
const gitlab = {
    issued: 0,
    refreshes: 0,
    validRefresh: new Set<string>(),
    down: false,
    reset() {
        this.issued = 0;
        this.refreshes = 0;
        this.validRefresh.clear();
        this.down = false;
    },
    pair() {
        const n = ++this.issued;
        const refresh = `gl-refresh-${n}`;
        this.validRefresh.add(refresh);
        return { access_token: `gl-access-${n}`, refresh_token: refresh, expires_in: 7200, token_type: 'bearer' };
    },
};

const fake = Bun.serve({
    port: 0,
    async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === '/oauth/token') {
            const body = new URLSearchParams(await req.text());
            if (body.get('grant_type') === 'authorization_code') return Response.json(gitlab.pair());
            gitlab.refreshes++;
            if (gitlab.down) return new Response('unavailable', { status: 503 });
            // Slow enough that concurrent callers overlap.
            await Bun.sleep(30);
            const used = body.get('refresh_token')!;
            if (!gitlab.validRefresh.delete(used)) return Response.json({ error: 'invalid_grant' }, { status: 400 });
            return Response.json(gitlab.pair());
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

/** Signs in through the GitLab OAuth flow; returns headers that carry the session. */
async function signIn(auth: TestAuth): Promise<Headers> {
    const start = await auth.handler(
        new Request(`${BASE_URL}/api/auth/sign-in/social`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: BASE_URL },
            body: JSON.stringify({ provider: 'gitlab', callbackURL: '/' }),
        }),
    );
    const { url } = (await start.json()) as { url: string };
    const state = new URL(url).searchParams.get('state')!;
    const callback = await auth.handler(
        new Request(`${BASE_URL}/api/auth/callback/gitlab?code=the-code&state=${state}`, {
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
        gitlab.reset();
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
        expect(gitlab.refreshes).toBe(0);
    });

    it('renews an expired token by itself and stores the new pair encrypted', async () => {
        expireStoredToken();

        const token = await getProviderAccessToken(auth, { headers, providerId: 'gitlab' });
        expect(token.accessToken).toBe('gl-access-2');
        expect(gitlab.refreshes).toBe(1);
        expect(row().accessToken).not.toContain('gl-access-2');
        expect(row().refreshToken).not.toContain('gl-refresh-2');

        // The renewed one is served from the database from then on.
        expect((await getProviderAccessToken(auth, { headers, providerId: 'gitlab' })).accessToken).toBe('gl-access-2');
        expect(gitlab.refreshes).toBe(1);
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
        expect(gitlab.refreshes).toBe(1);
    });

    it('works without a request, for a user id (background jobs)', async () => {
        expireStoredToken();
        const token = await getProviderAccessToken(auth, { userId: row().userId, providerId: 'gitlab' });
        expect(token.accessToken).toBe('gl-access-2');
    });

    it('asks to sign in again when the provider refuses the refresh token', async () => {
        gitlab.validRefresh.clear();
        expireStoredToken();
        const error = await getProviderAccessToken(auth, { headers, providerId: 'gitlab' }).catch((e) => e);
        expect(error).toBeInstanceOf(OAuthTokenError);
        expect(error.code).toBe('REFRESH_FAILED');
        expect(error.requiresSignIn).toBe(true);
    });

    it('keeps the stored pair when the provider is down, and renews once it is back', async () => {
        expireStoredToken();
        const before = row();
        gitlab.down = true;
        const error = await getProviderAccessToken(auth, { headers, providerId: 'gitlab' }).catch((e) => e);
        expect(error.code).toBe('PROVIDER_UNAVAILABLE');
        expect(error.requiresSignIn).toBe(false);
        expect(row().refreshToken).toBe(before.refreshToken);

        gitlab.down = false;
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

    it('cannot read the stored tokens once the secret changes', async () => {
        const rotated = buildAuth(sqlite, 'another-secret-at-least-32-chars-long');
        const error = await getProviderAccessToken(rotated, { userId: row().userId, providerId: 'gitlab' }).catch(
            (e) => e,
        );
        expect(error.code).toBe('TOKEN_UNREADABLE');
    });
});
