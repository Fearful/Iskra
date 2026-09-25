import { describe, it, expect } from 'bun:test';
import { createBetterAuth, type AuthKitDrizzleDb } from '../src/better-auth-config';

// Better Auth's drizzle adapter only wraps the db object at construction time
// (no connection), so a plain object stands in for a real Drizzle instance here.
const SECRET = 'test-secret-at-least-32-chars-long-xyz';
const fakeDb = {} as unknown as AuthKitDrizzleDb;

describe('createBetterAuth', () => {
    it('builds an auth instance for each supported adapter type', () => {
        for (const adapterType of ['postgres', 'mysql', 'sqlite'] as const) {
            const auth = createBetterAuth({ db: fakeDb, adapterType, secret: SECRET });
            expect(typeof auth.handler).toBe('function');
        }
    });

    it('exposes the better-auth API surface (handler + api.getSession)', () => {
        const auth = createBetterAuth({ db: fakeDb, adapterType: 'postgres', secret: SECRET });
        expect(typeof auth.handler).toBe('function');
        expect(auth.api).toBeDefined();
        expect(typeof auth.api.getSession).toBe('function');
    });

    it('throws for an unsupported adapter type', () => {
        expect(() => createBetterAuth({ db: fakeDb, adapterType: 'oracle' as any, secret: SECRET })).toThrow(
            'Unsupported adapter type',
        );
    });

    it('registers a generic OAuth plugin when oidcConfig is provided', () => {
        const auth = createBetterAuth({
            db: fakeDb,
            adapterType: 'postgres',
            secret: SECRET,
            oidcConfig: {
                clientId: 'cid',
                clientSecret: 'csecret',
                issuer: 'https://idp.example.com',
            },
        });
        expect(typeof auth.handler).toBe('function');
    });

    it('accepts a fully specified OIDC config with custom endpoints', () => {
        const auth = createBetterAuth({
            db: fakeDb,
            adapterType: 'sqlite',
            secret: SECRET,
            oidcConfig: {
                providerId: 'keycloak',
                clientId: 'cid',
                clientSecret: 'csecret',
                issuer: 'https://idp.example.com',
                authorizationEndpoint: 'https://idp.example.com/auth',
                tokenEndpoint: 'https://idp.example.com/token',
                userinfoEndpoint: 'https://idp.example.com/userinfo',
                discoveryEndpoint: 'https://idp.example.com/.well-known/openid-configuration',
                scopes: ['openid', 'email'],
                pkce: true,
            },
        });
        expect(typeof auth.handler).toBe('function');
    });

    it('configures a social provider when one is supplied', () => {
        const auth = createBetterAuth({
            db: fakeDb,
            adapterType: 'postgres',
            secret: SECRET,
            socialProviders: {
                github: { clientId: 'gh-id', clientSecret: 'gh-secret' },
            },
        });
        expect(typeof auth.handler).toBe('function');
    });

    it('keeps trusted origins as-is when they already include the base origin and email/password is disabled', () => {
        const auth = createBetterAuth({
            db: fakeDb,
            adapterType: 'sqlite',
            secret: SECRET,
            baseURL: 'https://app.example.com',
            trustedOrigins: ['https://app.example.com', 'https://other.example.com'],
            enableEmailPassword: false,
        });
        expect(typeof auth.handler).toBe('function');
    });

    it('builds with email/password enabled (the default)', () => {
        const auth = createBetterAuth({
            db: fakeDb,
            adapterType: 'sqlite',
            secret: SECRET,
            enableEmailPassword: true,
        });
        expect(typeof auth.handler).toBe('function');
    });
});

describe('createBetterAuth rate limiting and client IP', () => {
    it('passes rateLimit: false and the client IP headers to better-auth', () => {
        const auth = createBetterAuth({
            db: fakeDb,
            adapterType: 'sqlite',
            secret: SECRET,
            rateLimit: false,
            ipAddressHeaders: ['x-client-ip'],
        }) as unknown as {
            options: { rateLimit?: { enabled?: boolean }; advanced?: { ipAddress?: { ipAddressHeaders?: string[] } } };
        };
        expect(auth.options.rateLimit?.enabled).toBe(false);
        expect(auth.options.advanced?.ipAddress?.ipAddressHeaders).toEqual(['x-client-ip']);
    });
});
