/**
 * Creates the Better Auth tables (if missing) and an admin account.
 *
 *   bun run create-admin <email> <password> [name]
 *
 * The admin API disables public sign-up, so this is how accounts are made.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { createBetterAuth } from '@iskra-bun/auth-kit';
import { config } from '../app.config.ts';

// Better Auth's Postgres tables (matching @iskra-bun/auth-kit's pgSchema), also
// applied by docker-compose on the first start of the database.
export const AUTH_TABLES_DDL = readFileSync(resolve(import.meta.dir, '../../../../db/init/02-auth.sql'), 'utf8');

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
