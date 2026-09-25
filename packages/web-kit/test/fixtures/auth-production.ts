// Run with NODE_ENV=production from the start: better-auth reads it when
// imported, and only then turns its own rate limiter on. Prints the statuses.
import { AuthFeature } from '../../src/features/auth/index';
import { DbFeature } from '../../src/features/db';
import { Kernel } from '../../src/kernel';

const DDL = `
CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT, email TEXT NOT NULL UNIQUE, emailVerified INTEGER NOT NULL, image TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
CREATE TABLE session (id TEXT PRIMARY KEY, expiresAt INTEGER NOT NULL, token TEXT NOT NULL UNIQUE, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, ipAddress TEXT, userAgent TEXT, userId TEXT NOT NULL REFERENCES user(id));
CREATE TABLE account (id TEXT PRIMARY KEY, accountId TEXT NOT NULL, providerId TEXT NOT NULL, userId TEXT NOT NULL REFERENCES user(id), accessToken TEXT, refreshToken TEXT, idToken TEXT, accessTokenExpiresAt INTEGER, refreshTokenExpiresAt INTEGER, scope TEXT, password TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
CREATE TABLE verification (id TEXT PRIMARY KEY, identifier TEXT NOT NULL, value TEXT NOT NULL, expiresAt INTEGER NOT NULL, createdAt INTEGER, updatedAt INTEGER);
`;
const ORIGIN = 'https://app.example.com';

const kernel = new Kernel();
const db = new DbFeature({ adapter: 'sqlite', connection: { database: ':memory:' } });
kernel.registerFeature(db);
kernel.registerFeature(
    new AuthFeature({
        secret: 'a-contract-secret-with-enough-entropy-1f9c2e7b',
        baseURL: ORIGIN,
        basePath: '/api/sso',
        trustedOrigins: [ORIGIN],
    }),
);
await kernel.initialize();
(db.db as unknown as { $client: { exec(sql: string): void } }).$client.exec(DDL);
const app = kernel.getApp();

/** A request from `address`, as Bun.serve passes it (no proxy headers). */
const from = (address: string) => ({ requestIP: () => ({ address, family: 'IPv4', port: 40000 }) });
const signIn = (extra: Record<string, string> = {}) => ({
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, ...extra },
    body: JSON.stringify({ email: 'nobody@example.com', password: 'wrong' }),
});

const first: number[] = [];
for (let i = 0; i < 4; i++)
    first.push((await app.request('/api/sso/sign-in/email', signIn(), from('198.51.100.1'))).status);
const other = (await app.request('/api/sso/sign-in/email', signIn(), from('198.51.100.2'))).status;
const spoofed: number[] = [];
for (let i = 0; i < 4; i++) {
    spoofed.push(
        (
            await app.request(
                '/api/sso/sign-in/email',
                signIn({ 'x-iskra-client-ip': `203.0.113.${i}` }),
                from('198.51.100.3'),
            )
        ).status,
    );
}
console.log(`RESULT ${JSON.stringify({ first, other, spoofed })}`);
process.exit(0);
