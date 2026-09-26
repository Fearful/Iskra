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
});
