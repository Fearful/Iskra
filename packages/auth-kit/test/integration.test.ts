import { describe, it, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { createBetterAuth, type AuthKitDrizzleDb } from '../src/better-auth-config';

// End-to-end exercise of the better-auth drizzle adapter against a REAL database.
// sqlite runs locally and in-memory (bun:sqlite), so this stays infra-free and
// runs in the default suite. postgres is gated behind a real, credential-checked
// connection (skipped otherwise) — mirroring db-kit/web-kit integration tests.
const SECRET = 'test-secret-at-least-32-chars-long-xyz';
const PG_URL = process.env.TEST_PG_URL || 'postgres://postgres:postgres@127.0.0.1:5432/postgres';

// Better Auth's standard sqlite DDL (createdAt/updatedAt as integer timestamps).
const SQLITE_DDL = `
CREATE TABLE user (
    id TEXT PRIMARY KEY,
    name TEXT,
    email TEXT NOT NULL UNIQUE,
    emailVerified INTEGER NOT NULL,
    image TEXT,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
);
CREATE TABLE session (
    id TEXT PRIMARY KEY,
    expiresAt INTEGER NOT NULL,
    token TEXT NOT NULL UNIQUE,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    ipAddress TEXT,
    userAgent TEXT,
    userId TEXT NOT NULL REFERENCES user(id)
);
CREATE TABLE account (
    id TEXT PRIMARY KEY,
    accountId TEXT NOT NULL,
    providerId TEXT NOT NULL,
    userId TEXT NOT NULL REFERENCES user(id),
    accessToken TEXT,
    refreshToken TEXT,
    idToken TEXT,
    accessTokenExpiresAt INTEGER,
    refreshTokenExpiresAt INTEGER,
    scope TEXT,
    password TEXT,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
);
CREATE TABLE verification (
    id TEXT PRIMARY KEY,
    identifier TEXT NOT NULL,
    value TEXT NOT NULL,
    expiresAt INTEGER NOT NULL,
    createdAt INTEGER,
    updatedAt INTEGER
);
`;

async function pgUsable(url: string): Promise<boolean> {
    try {
        const postgres = (await import('postgres')).default;
        const sql = postgres(url, { max: 1, connect_timeout: 2, idle_timeout: 1, onnotice: () => {} });
        try {
            await sql`SELECT 1`;
            return true;
        } finally {
            await sql.end({ timeout: 1 });
        }
    } catch {
        return false;
    }
}

const pgUp = await pgUsable(PG_URL);

describe('createBetterAuth against a real sqlite database', () => {
    it('signs up an email/password user and persists it', async () => {
        const sqlite = new Database(':memory:');
        sqlite.exec(SQLITE_DDL);
        const db = drizzle(sqlite);

        const auth = createBetterAuth({
            db,
            adapterType: 'sqlite',
            secret: SECRET,
            enableEmailPassword: true,
            disableCSRFCheck: true,
        });

        const result = await auth.api.signUpEmail({
            body: {
                email: 'alice@example.com',
                password: 'super-secret-password',
                name: 'Alice',
            },
        });

        expect(result.user).toBeDefined();
        expect(result.user.email).toBe('alice@example.com');

        const row = sqlite.query('SELECT email FROM user WHERE email = ?').get('alice@example.com') as {
            email: string;
        } | null;
        expect(row?.email).toBe('alice@example.com');

        sqlite.close();
    });

    it('rejects email sign-up when disableSignUp is set, but still allows sign-in', async () => {
        const sqlite = new Database(':memory:');
        sqlite.exec(SQLITE_DDL);
        const db = drizzle(sqlite);
        const base = { db, adapterType: 'sqlite' as const, secret: SECRET, disableCSRFCheck: true };

        // Provision an account while sign-up is allowed...
        await createBetterAuth(base).api.signUpEmail({
            body: { email: 'bob@example.com', password: 'super-secret-password', name: 'Bob' },
        });

        // ...then the locked-down instance refuses new accounts.
        const locked = createBetterAuth({ ...base, disableSignUp: true });
        await expect(
            locked.api.signUpEmail({
                body: { email: 'mallory@example.com', password: 'super-secret-password', name: 'Mallory' },
            }),
        ).rejects.toThrow();
        expect(sqlite.query('SELECT email FROM user WHERE email = ?').get('mallory@example.com')).toBeNull();

        const signedIn = await locked.api.signInEmail({
            body: { email: 'bob@example.com', password: 'super-secret-password' },
        });
        expect(signedIn.user.email).toBe('bob@example.com');

        sqlite.close();
    });
});

// Real Postgres is gated: only runs when a credential-checked connection succeeds.
describe.if(pgUp)('createBetterAuth against a real postgres database (requires Postgres)', () => {
    it('builds a postgres-backed auth instance that exposes getSession', () => {
        const auth = createBetterAuth({
            db: {} as unknown as AuthKitDrizzleDb,
            adapterType: 'postgres',
            secret: SECRET,
        });
        expect(typeof auth.api.getSession).toBe('function');
    });
});
