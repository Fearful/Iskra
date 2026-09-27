import { describe, it, expect, afterEach } from 'bun:test';
import { AuthFeature, requireAuth } from '../src/features/auth/index';
import { DbFeature } from '../src/features/db';
import { Kernel } from '../src/kernel';

// Real better-auth on in-memory sqlite (see auth-review.test.ts).

const DDL = `
CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT, email TEXT NOT NULL UNIQUE, emailVerified INTEGER NOT NULL, image TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
CREATE TABLE session (id TEXT PRIMARY KEY, expiresAt INTEGER NOT NULL, token TEXT NOT NULL UNIQUE, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, ipAddress TEXT, userAgent TEXT, userId TEXT NOT NULL REFERENCES user(id));
CREATE TABLE account (id TEXT PRIMARY KEY, accountId TEXT NOT NULL, providerId TEXT NOT NULL, userId TEXT NOT NULL REFERENCES user(id), accessToken TEXT, refreshToken TEXT, idToken TEXT, accessTokenExpiresAt INTEGER, refreshTokenExpiresAt INTEGER, scope TEXT, password TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
CREATE TABLE verification (id TEXT PRIMARY KEY, identifier TEXT NOT NULL, value TEXT NOT NULL, expiresAt INTEGER NOT NULL, createdAt INTEGER, updatedAt INTEGER);
`;
const SECRET = 'a-contract-secret-with-enough-entropy-1f9c2e7b';
const ORIGIN = 'http://localhost:3000';

const savedEnv = process.env.NODE_ENV;
afterEach(() => {
    if (savedEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedEnv;
});

async function setup() {
    process.env.NODE_ENV = 'development';
    const kernel = new Kernel();
    const db = new DbFeature({ adapter: 'sqlite', connection: { database: ':memory:' } });
    kernel.registerFeature(db);
    const feature = new AuthFeature({
        secret: SECRET,
        basePath: '/api/sso',
        baseURL: ORIGIN,
        rateLimit: false,
    } as any);
    kernel.registerFeature(feature);
    await kernel.initialize();
    (db.db as unknown as { $client: { exec(sql: string): void } }).$client.exec(DDL);

    // Counts the session reads per request.
    const api = feature.getAuth()!.api as unknown as { getSession: (...args: unknown[]) => Promise<unknown> };
    const original = api.getSession.bind(api);
    const calls = { count: 0 };
    api.getSession = (...args: unknown[]) => {
        calls.count++;
        return original(...args);
    };

    const app = kernel.getApp();
    app.get('/me', requireAuth(kernel), (c) => c.json({ id: (c.get('authUser') as { id: string }).id }));
    return { app, calls };
}

describe('requireAuth', () => {
    it('answers 401 without a session cookie', async () => {
        const { app } = await setup();
        const res = await app.request('/me');
        expect(res.status).toBe(401);
    });

    it('lets a signed-in request through, reading the session once', async () => {
        const { app, calls } = await setup();
        const signUp = await app.request('/api/sso/sign-up/email', {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: ORIGIN },
            body: JSON.stringify({ email: 'me@example.com', password: 'password1234', name: 'Me' }),
        });
        expect(signUp.status).toBe(200);
        const cookie = (signUp.headers.get('set-cookie') ?? '').split(';')[0]!;
        expect(cookie).toContain('session_token');

        calls.count = 0;
        const res = await app.request('/me', { headers: { cookie } });
        expect(res.status).toBe(200);
        expect(((await res.json()) as { id: string }).id).toBeString();
        // The global middleware already read it; requireAuth used to read it again.
        expect(calls.count).toBe(1);
    });
});
