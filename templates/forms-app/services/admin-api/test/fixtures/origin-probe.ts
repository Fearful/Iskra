// Child process for origins.test.ts: prints, as JSON, the status of a sign-in
// from each origin given as an argument. Run as a separate process because
// better-auth skips its Origin check under NODE_ENV=test.
// It checks the Origin before touching the database, so in-memory SQLite is
// enough: 403 INVALID_ORIGIN, or past that check (400: no such user).
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { createBetterAuth } from '@iskra-bun/auth-kit';
import { config } from '../../src/app.config.ts';

const auth = createBetterAuth({
    db: drizzle(new Database(':memory:')),
    adapterType: 'sqlite',
    secret: config.auth.secret,
    baseURL: config.auth.baseURL,
    basePath: config.auth.basePath,
    trustedOrigins: config.cors.origins.split(','),
});

const statuses: Record<string, number> = {};
for (const origin of process.argv.slice(2)) {
    const res = await auth.handler(
        new Request(`${config.auth.baseURL}${config.auth.basePath}/sign-in/email`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                origin,
                cookie: 'x=1',
                'sec-fetch-site': 'same-origin',
                'sec-fetch-mode': 'cors',
            },
            body: JSON.stringify({ email: 'nobody', password: 'irrelevant-password' }),
        }),
    );
    statuses[origin] = res.status;
}
console.log(JSON.stringify(statuses));
