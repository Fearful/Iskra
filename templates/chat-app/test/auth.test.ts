import { describe, it, expect } from 'bun:test';
import { issueToken, normalizeUsername, resolveAuthSecret, verifyToken } from '../src/auth';
import { forTerminal } from '../src/terminal';

const SECRET = 'a-test-secret-that-is-at-least-32-chars';

describe('chat tokens', () => {
    it('verifies a token the server issued', () => {
        expect(verifyToken(issueToken('ana', SECRET), SECRET)).toEqual({ userId: 'u_ana', username: 'ana' });
    });

    it('cannot be forged without the secret', () => {
        // The old format was `token:<username>:<secret>`: every client held the
        // server secret and could sign in as anyone.
        expect(verifyToken(`token:bob:${SECRET}`, SECRET)).toBeNull();

        // Renaming the user in a valid token breaks the signature.
        const [version, , expiresAt, signature] = issueToken('ana', SECRET).split('.');
        expect(verifyToken([version, 'bob', expiresAt, signature].join('.'), SECRET)).toBeNull();

        // A token signed with another secret is refused.
        expect(verifyToken(issueToken('bob', 'another-secret-that-is-32-chars-long!'), SECRET)).toBeNull();
    });

    it('expires', () => {
        const now = Date.UTC(2026, 0, 1);
        const token = issueToken('ana', SECRET, { ttlSeconds: 60, now });
        expect(verifyToken(token, SECRET, now + 59_000)).not.toBeNull();
        expect(verifyToken(token, SECRET, now + 60_000)).toBeNull();
    });

    it('normalizes usernames, so Ana and ana are one user', () => {
        expect(normalizeUsername('Ana')).toBe('ana');
        expect(verifyToken(issueToken('Ana', SECRET), SECRET)?.username).toBe('ana');
        expect(normalizeUsername('ana\u001b[2J')).toBeNull();
        expect(normalizeUsername('a'.repeat(33))).toBeNull();
        expect(() => issueToken('not valid', SECRET)).toThrow();
    });
});

describe('CHAT_AUTH_SECRET', () => {
    it('refuses to run in production without a strong secret', () => {
        for (const weak of [undefined, '', 'dev-secret', 'short-secret']) {
            expect(() => resolveAuthSecret(weak, true)).toThrow(/CHAT_AUTH_SECRET/);
        }
        expect(resolveAuthSecret(SECRET, true)).toEqual({ secret: SECRET });
    });

    it('falls back to the dev secret only outside production, with a warning', () => {
        // `?? 'dev-secret'` kept an empty CHAT_AUTH_SECRET as the secret.
        expect(resolveAuthSecret('', false).secret).toBe('dev-secret');
        expect(resolveAuthSecret(undefined, false).warning).toBeDefined();
    });
});

describe('terminal client', () => {
    it('strips escape sequences before printing what peers send', () => {
        const hostile = 'hola\u001b]0;pwned\u0007\u001b[2J\u009b31m\u202egnirts';
        expect(forTerminal(hostile)).toBe('hola]0;pwned[2J31mgnirts');
        expect(forTerminal('dos\nlineas')).toBe('dos lineas');
    });
});
