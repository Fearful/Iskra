/**
 * Creates the Better Auth tables (if missing) and an admin account.
 *
 *   bun run create-admin <email> [--name <name>]
 *
 * The password comes from ADMIN_PASSWORD, or is asked for (without echo), or
 * is read from stdin when it is not a terminal. The admin API disables public
 * sign-up, so this is how accounts are made.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
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

const USAGE = 'usage: bun run create-admin <email> [--name <name>]  (password: ADMIN_PASSWORD, the prompt or stdin)';

/** The email and name from the command line, which no longer takes the password. */
export function parseCreateAdminArgs(args: string[]): { email: string; name?: string } {
    const { values, positionals } = parseArgs({ args, options: { name: { type: 'string' } }, allowPositionals: true });
    if (positionals.length > 1) {
        // A password there is in `ps` for every user and in the shell history.
        throw new Error(`the password is not taken as an argument\n${USAGE}`);
    }
    if (positionals.length === 0) throw new Error(USAGE);
    return { email: positionals[0], name: values.name };
}

/** Reads a line from a terminal without echoing it. */
function promptHidden(stdin: NodeJS.ReadStream, question: string): Promise<string> {
    process.stderr.write(question);
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    return new Promise((resolve, reject) => {
        let line = '';
        const onData = (chunk: string) => {
            for (const char of chunk) {
                const code = char.charCodeAt(0);
                if (char === '\r' || char === '\n') return finish(() => resolve(line));
                // Ctrl-C cancels; Backspace (DEL or BS) removes the last character.
                if (code === 3) return finish(() => reject(new Error('cancelled')));
                line = code === 127 || code === 8 ? line.slice(0, -1) : line + char;
            }
        };
        const finish = (settle: () => void) => {
            stdin.off('data', onData);
            stdin.setRawMode(false);
            stdin.pause();
            process.stderr.write('\n');
            settle();
        };
        stdin.on('data', onData);
    });
}

/**
 * The new admin's password: ADMIN_PASSWORD; otherwise typed twice at the
 * terminal, or the first line of stdin when it is a pipe or a file.
 */
export async function readAdminPassword(
    env: Record<string, string | undefined> = process.env,
    stdin: NodeJS.ReadStream = process.stdin,
): Promise<string> {
    if (env.ADMIN_PASSWORD) return env.ADMIN_PASSWORD;
    if (!stdin.isTTY) {
        let text = '';
        for await (const chunk of stdin) text += chunk;
        return text.split(/\r?\n/)[0];
    }
    const password = await promptHidden(stdin, 'Password: ');
    if ((await promptHidden(stdin, 'Repeat the password: ')) !== password) {
        throw new Error('the passwords do not match');
    }
    return password;
}

if (import.meta.main) {
    try {
        const { email, name } = parseCreateAdminArgs(process.argv.slice(2));
        const password = await readAdminPassword();
        if (!password) throw new Error('empty password');
        const user = await createAdmin(config.db.url, email, password, name);
        console.log(`Admin created: ${user.email} (${user.id})`);
    } catch (err) {
        console.error(`create-admin: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
    }
}
