import { describe, it, expect } from 'bun:test';
import { mapOidcProfile } from '../src/better-auth-config';

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
