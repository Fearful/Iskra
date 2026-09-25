import { describe, it, expect } from 'bun:test';
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
