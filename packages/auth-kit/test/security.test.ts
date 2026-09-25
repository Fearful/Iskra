import { afterEach, describe, it, expect } from 'bun:test';
import { createBetterAuth, type AuthKitDrizzleDb } from '../src/better-auth-config';

// Security regression tests (RED stage of TDD) covering audit findings on
// src/better-auth-config.ts. Better Auth's drizzle adapter only wraps the db
// object at construction time (no connection), so a plain object stands in for
// a real Drizzle instance — matching the existing better-auth-config.test.ts.
const VALID_SECRET = 'test-secret-at-least-32-chars-long-xyz'; // 38 chars
const fakeDb = {} as unknown as AuthKitDrizzleDb;

const oidcBase = {
    clientId: 'cid',
    clientSecret: 'csecret',
    issuer: 'https://idp.example.com',
} as const;

// Reaches into the constructed better-auth instance to read the generic-OAuth
// plugin's resolved provider config (where the pkce flag actually lands).
function oauthProviderConfig(auth: unknown): Record<string, unknown> {
    const plugins = (auth as { options?: { plugins?: unknown[] } }).options?.plugins ?? [];
    const go = plugins.find((p) =>
        String((p as { id?: unknown }).id ?? '')
            .toLowerCase()
            .includes('oauth'),
    ) as { options?: { config?: Record<string, unknown>[] } } | undefined;
    const cfg = go?.options?.config?.[0];
    if (!cfg) throw new Error('generic-oauth provider config not found');
    return cfg;
}

// HIGH — secret validation (src/better-auth-config.ts:40).
// An empty or weak secret signs forgeable sessions. Construction must reject
// any secret shorter than 32 chars before betterAuth() ever sees it.
describe('createBetterAuth secret validation', () => {
    it('throws when secret is an empty string', () => {
        expect(() => createBetterAuth({ db: fakeDb, adapterType: 'postgres', secret: '' })).toThrow();
    });

    it('throws when secret is shorter than 32 characters', () => {
        const shortSecret = 'a'.repeat(31);
        expect(() => createBetterAuth({ db: fakeDb, adapterType: 'postgres', secret: shortSecret })).toThrow();
    });

    it('accepts a secret of exactly 32 characters', () => {
        const secret = 'b'.repeat(32);
        const auth = createBetterAuth({ db: fakeDb, adapterType: 'postgres', secret });
        expect(typeof auth.handler).toBe('function');
    });

    it('accepts a secret longer than 32 characters', () => {
        const auth = createBetterAuth({ db: fakeDb, adapterType: 'postgres', secret: VALID_SECRET });
        expect(typeof auth.handler).toBe('function');
    });
});

// HIGH (defense in depth) — a sample secret copied from docs or .env.example
// into production is public, and it signs the session cookie cache, which is
// trusted without a database lookup: anyone could forge a session.
describe('createBetterAuth placeholder secrets', () => {
    const savedEnv = process.env.NODE_ENV;
    afterEach(() => {
        process.env.NODE_ENV = savedEnv;
    });
    const build = (secret: string) => () => createBetterAuth({ db: fakeDb, adapterType: 'postgres', secret });
    const placeholders = [
        'dev-secret-change-me-min-32-characters-long',
        'dev-only-auth-secret-change-me-32chars',
        'change-me-in-production-min-32-chars',
        'CHANGEME_CHANGEME_CHANGEME_CHANGEME',
        'your-secret-key-with-at-least-32-characters',
        'placeholder-placeholder-placeholder',
    ];

    it('refuses them in production', () => {
        process.env.NODE_ENV = 'production';
        for (const secret of placeholders) expect(build(secret)).toThrow(/looks like a placeholder/);
    });

    it('names the marker, not the secret, in the error', () => {
        process.env.NODE_ENV = 'production';
        let message = '';
        try {
            build(placeholders[0])();
        } catch (err) {
            message = (err as Error).message;
        }
        expect(message).toContain('contains "change-me"');
        expect(message).not.toContain(placeholders[0]);
    });

    it('accepts a random secret in production, and the samples outside it', () => {
        process.env.NODE_ENV = 'production';
        expect(build('k7Hq2Vx9Lm4Tz8Rb1Nw6Pc3Yd5Fg0Js2Ua')).not.toThrow();
        process.env.NODE_ENV = 'development';
        for (const secret of placeholders) expect(build(secret)).not.toThrow();
    });
});

// HIGH — PKCE default (src/better-auth-config.ts:106).
// Defaulting generic-OAuth pkce to false exposes auth-code interception. The
// secure default is pkce=true; disabling must require an explicit override.
describe('createBetterAuth OIDC PKCE default', () => {
    it('enables PKCE by default when oidcConfig.pkce is unset', () => {
        const auth = createBetterAuth({
            db: fakeDb,
            adapterType: 'postgres',
            secret: VALID_SECRET,
            oidcConfig: { ...oidcBase },
        });
        expect(oauthProviderConfig(auth).pkce).toBe(true);
    });

    it('keeps PKCE enabled when oidcConfig.pkce is explicitly true', () => {
        const auth = createBetterAuth({
            db: fakeDb,
            adapterType: 'postgres',
            secret: VALID_SECRET,
            oidcConfig: { ...oidcBase, pkce: true },
        });
        expect(oauthProviderConfig(auth).pkce).toBe(true);
    });

    it('allows disabling PKCE only via an explicit false override', () => {
        const auth = createBetterAuth({
            db: fakeDb,
            adapterType: 'postgres',
            secret: VALID_SECRET,
            oidcConfig: { ...oidcBase, pkce: false },
        });
        expect(oauthProviderConfig(auth).pkce).toBe(false);
    });
});

// MEDIUM — cookieCache maxAge (src/better-auth-config.ts:139).
// The 5-minute (300s) cookie-cache window is the session-revocation lag. It
// must be configurable so callers can tighten the revocation window.
describe('createBetterAuth cookie cache maxAge', () => {
    function cookieCacheMaxAge(auth: unknown): number | undefined {
        return (auth as { options?: { session?: { cookieCache?: { maxAge?: number } } } }).options?.session?.cookieCache
            ?.maxAge;
    }

    it('defaults the cookie cache maxAge to 5 minutes (300s)', () => {
        const auth = createBetterAuth({ db: fakeDb, adapterType: 'postgres', secret: VALID_SECRET });
        expect(cookieCacheMaxAge(auth)).toBe(300);
    });

    it('honors a custom cookieCacheMaxAge to shrink the revocation window', () => {
        const auth = createBetterAuth({
            db: fakeDb,
            adapterType: 'postgres',
            secret: VALID_SECRET,
            cookieCacheMaxAge: 30,
        } as Parameters<typeof createBetterAuth>[0] & { cookieCacheMaxAge: number });
        expect(cookieCacheMaxAge(auth)).toBe(30);
    });
});

// HIGH — better-auth skips its Origin check (CSRF on cookie requests) and its
// callbackURL validation (open redirects) when it believes it runs under test:
// NODE_ENV=test or any TEST variable other than "false". `bun test` sets
// NODE_ENV=test, so these requests were accepted before auth-kit pinned
// `advanced.disableOriginCheck: false`.
describe('createBetterAuth origin checks outside the test runner too', () => {
    const auth = createBetterAuth({
        db: fakeDb,
        adapterType: 'sqlite',
        secret: VALID_SECRET,
        baseURL: 'https://app.example.com',
    });

    it('rejects a callbackURL on an untrusted origin', async () => {
        const res = await auth.handler(
            new Request('https://app.example.com/api/auth/sign-in/email', {
                method: 'POST',
                headers: { 'content-type': 'application/json', origin: 'https://app.example.com' },
                body: JSON.stringify({
                    email: 'user@example.com',
                    password: 'correct-horse-battery',
                    callbackURL: 'https://evil.example/phish',
                }),
            }),
        );
        expect(res.status).toBe(403);
    });

    it('rejects a cookie-bearing POST from another origin', async () => {
        const res = await auth.handler(
            new Request('https://app.example.com/api/auth/sign-out', {
                method: 'POST',
                headers: { origin: 'https://evil.example', cookie: 'better-auth.session_token=abc.def' },
            }),
        );
        expect(res.status).toBe(403);
    });
});
