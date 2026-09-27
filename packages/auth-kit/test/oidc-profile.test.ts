import { describe, it, expect } from 'bun:test';
import { mapOidcProfile, oidcProviderConfig } from '../src/better-auth-config';

describe('mapOidcProfile', () => {
    it('maps the standard claims', () => {
        expect(
            mapOidcProfile({
                sub: 'abc',
                email: 'a@b.c',
                name: 'Ana',
                picture: 'https://img/a.png',
                email_verified: true,
                emailVerified: false,
            }),
        ).toEqual({ email: 'a@b.c', name: 'Ana', image: 'https://img/a.png', emailVerified: true });
    });

    it('falls back to preferred_username and a string email_verified', () => {
        const user = mapOidcProfile({
            id: 42,
            email: 'x@y.z',
            preferred_username: 'xy',
            email_verified: 'true',
            emailVerified: false,
        });
        expect(user.name).toBe('xy');
        expect(user.emailVerified).toBe(true);
    });

    it('returns no id: the account identity comes from the verified sub', () => {
        expect('id' in mapOidcProfile({ sub: 'abc', id: 7, emailVerified: false })).toBe(false);
    });

    it('reads the claims named in mapping instead of the standard ones', () => {
        const mapping = { email: 'mail', name: 'displayName', image: 'avatar', emailVerified: 'mail_verified' };
        const profile = {
            sub: 'abc',
            email: 'std@b.c',
            name: 'Std',
            picture: 'https://img/std.png',
            email_verified: false,
            emailVerified: false,
            mail: 'custom@b.c',
            displayName: 'Custom',
            avatar: 'https://img/custom.png',
            mail_verified: 'true',
        };
        expect(mapOidcProfile(profile, mapping)).toEqual({
            email: 'custom@b.c',
            name: 'Custom',
            image: 'https://img/custom.png',
            emailVerified: true,
        });
        // A mapped emailVerified claim that is not true / "true" is not verified.
        expect(mapOidcProfile({ ...profile, email_verified: true, mail_verified: false }, mapping).emailVerified).toBe(
            false,
        );
    });

    it('falls back to the standard claims when a mapped claim is missing', () => {
        const user = mapOidcProfile(
            { sub: 'abc', email: 'std@b.c', name: 'Std', email_verified: true, emailVerified: false },
            { email: 'mail', name: 'displayName', emailVerified: 'mail_verified' },
        );
        expect(user).toEqual({ email: 'std@b.c', name: 'Std', image: undefined, emailVerified: true });
    });
});

describe('mapOidcProfile: which flag vouches for the email', () => {
    it('does not let the standard email_verified vouch for a different mapped email', () => {
        // Regression: an IdP user who can edit `mail` would be linked to the
        // local account with that address (better-auth links verified emails).
        const user = mapOidcProfile(
            {
                sub: 'abc',
                email: 'attacker@idp.com',
                email_verified: true,
                emailVerified: false,
                mail: 'admin@corp.com',
            },
            { email: 'mail' },
        );
        expect(user).toMatchObject({ email: 'admin@corp.com', emailVerified: false });
    });

    it('does not fall back to email_verified when the mapped flag is missing', () => {
        const user = mapOidcProfile(
            {
                sub: 'abc',
                email: 'attacker@idp.com',
                email_verified: true,
                emailVerified: false,
                mail: 'admin@corp.com',
            },
            { email: 'mail', emailVerified: 'mail_verified' },
        );
        expect(user.emailVerified).toBe(false);
    });

    it('keeps the standard flag when the mapped email is the standard one', () => {
        const user = mapOidcProfile(
            { sub: 'abc', email: 'a@b.c', email_verified: true, emailVerified: false, mail: 'a@b.c' },
            { email: 'mail' },
        );
        expect(user.emailVerified).toBe(true);
    });

    it('pairs a mapped flag with the standard email when mapping.email is not set', () => {
        const profile = { sub: 'abc', email: 'a@b.c', email_verified: false, emailVerified: false, verified: 'true' };
        expect(mapOidcProfile(profile, { emailVerified: 'verified' }).emailVerified).toBe(true);
    });
});

describe('oidcProviderConfig', () => {
    const base = { clientId: 'id', clientSecret: 'secret', issuer: 'https://idp.example.com' };

    it('leaves the endpoints to discovery when none is configured', () => {
        // Regression: Keycloak's /protocol/openid-connect/* paths were set by
        // default, and better-auth only fills the endpoints left unset.
        const config = oidcProviderConfig(base);
        expect(config.authorizationUrl).toBeUndefined();
        expect(config.tokenUrl).toBeUndefined();
        expect(config.userInfoUrl).toBeUndefined();
        expect(config.discoveryUrl).toBe('https://idp.example.com/.well-known/openid-configuration');
        expect(config.pkce).toBe(true);
    });

    it('keeps the endpoints and the discovery URL that are configured', () => {
        const config = oidcProviderConfig({
            ...base,
            authorizationEndpoint: 'https://idp.example.com/authorize',
            tokenEndpoint: 'https://idp.example.com/token',
            userinfoEndpoint: 'https://idp.example.com/userinfo',
            discoveryEndpoint: 'https://idp.example.com/custom/discovery',
        });
        expect(config.authorizationUrl).toBe('https://idp.example.com/authorize');
        expect(config.tokenUrl).toBe('https://idp.example.com/token');
        expect(config.userInfoUrl).toBe('https://idp.example.com/userinfo');
        expect(config.discoveryUrl).toBe('https://idp.example.com/custom/discovery');
    });

    it('maps the profile with the configured claim mapping', async () => {
        // Regression: `mapping` was accepted but never read.
        const config = oidcProviderConfig({ ...base, mapping: { email: 'mail', emailVerified: 'mail_verified' } });
        const user = await config.mapProfileToUser({
            sub: 'abc',
            email: 'std@b.c',
            mail: 'custom@b.c',
            mail_verified: true,
            emailVerified: false,
        });
        expect(user.email).toBe('custom@b.c');
        expect(user.emailVerified).toBe(true);
    });
});
