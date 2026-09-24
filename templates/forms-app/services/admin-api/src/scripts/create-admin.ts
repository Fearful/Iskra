/**
 * Creates the Better Auth tables (if missing) and an admin account.
 *
 *   bun run create-admin <email> <password> [name]
 *
 * The admin API disables public sign-up, so this is how accounts are made.
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { createBetterAuth } from '@iskra-bun/auth-kit';
import { config } from '../app.config.ts';

// Better Auth's Postgres tables, matching @iskra-bun/auth-kit's pgSchema.
export const AUTH_TABLES_DDL = `
CREATE TABLE IF NOT EXISTS "user" (
  id text PRIMARY KEY, name text, email text NOT NULL UNIQUE, "emailVerified" boolean NOT NULL,
  image text, "createdAt" timestamp NOT NULL, "updatedAt" timestamp NOT NULL);
CREATE TABLE IF NOT EXISTS session (
  id text PRIMARY KEY, "expiresAt" timestamp NOT NULL, token text NOT NULL UNIQUE,
  "createdAt" timestamp NOT NULL, "updatedAt" timestamp NOT NULL, "ipAddress" text, "userAgent" text,
  "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS account (
  id text PRIMARY KEY, "accountId" text NOT NULL, "providerId" text NOT NULL,
  "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "accessToken" text, "refreshToken" text, "idToken" text,
  "accessTokenExpiresAt" timestamp, "refreshTokenExpiresAt" timestamp, scope text, password text,
  "createdAt" timestamp NOT NULL, "updatedAt" timestamp NOT NULL);
CREATE TABLE IF NOT EXISTS verification (
  id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL, "expiresAt" timestamp NOT NULL,
  "createdAt" timestamp, "updatedAt" timestamp);
`;

export async function createAdmin(databaseUrl: string, email: string, password: string, name = 'Admin') {
    const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
    try {
        await sql.unsafe(AUTH_TABLES_DDL);
        // Sign-up stays enabled only for this server-side instance.
        const auth = createBetterAuth({
            db: drizzle(sql),
            adapterType: 'postgres',
            secret: config.auth.secret,
            baseURL: config.auth.baseURL,
            basePath: config.auth.basePath,
        });
        const { user } = await auth.api.signUpEmail({ body: { email, password, name } });
        return user;
    } finally {
        await sql.end({ timeout: 5 });
    }
}

if (import.meta.main) {
    const [email, password, name] = process.argv.slice(2);
    if (!email || !password) {
        console.error('usage: bun run create-admin <email> <password> [name]');
        process.exit(1);
    }
    const user = await createAdmin(config.db.url, email, password, name);
    console.log(`Admin created: ${user.email} (${user.id})`);
}
