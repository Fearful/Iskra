import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { Hono } from 'hono';
import { Kernel, DbFeature, AuthFeature } from '@iskra-bun/web-kit';
import router from '../src/interfaces/http/router.ts';
import { SpaceService } from '../src/domain/spaces/space.service.ts';
import { config } from '../src/app.config.ts';
import { createAdmin } from '../src/scripts/create-admin.ts';

// The admin API end to end against a real Postgres: accounts come only from
// `create-admin`, public sign-up is closed, and every /api route needs a session.
const PG_URL = process.env.TEST_PG_URL || 'postgres://postgres:postgres@127.0.0.1:5432/postgres';

async function pgUsable(url: string): Promise<boolean> {
    try {
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

const DROP = 'DROP TABLE IF EXISTS session, account, verification, "user", answers, form_fields, forms, spaces CASCADE;';
const SPACES = `CREATE TABLE spaces (
  id text PRIMARY KEY, name text NOT NULL, slug text NOT NULL UNIQUE,
  created_at timestamp DEFAULT now() NOT NULL, updated_at timestamp DEFAULT now() NOT NULL);`;

const pgUp = await pgUsable(PG_URL);
const ORIGIN = config.cors.origins.split(',')[0];

describe.if(pgUp)('admin-api authentication (requires Postgres)', () => {
    let sql: ReturnType<typeof postgres>;
    let kernel: Kernel;
    let app: Hono;

    beforeAll(async () => {
        sql = postgres(PG_URL, { max: 2, onnotice: () => {} });
        await sql.unsafe(DROP);
        await sql.unsafe(SPACES);
        SpaceService.setDb(drizzle(sql));

        await createAdmin(PG_URL, 'admin@example.com', 'correct-horse-battery-staple');

        // Same feature wiring as src/main.ts.
        kernel = new Kernel();
        kernel.registerFeature(new DbFeature({ adapter: 'postgres', connection: { connectionString: PG_URL } }));
        kernel.registerFeature(
            new AuthFeature({
                secret: config.auth.secret,
                baseURL: config.auth.baseURL,
                basePath: config.auth.basePath,
                trustedOrigins: config.cors.origins.split(','),
                enableSelfRegistration: false,
            }),
        );
        await kernel.initialize();
        const api = new Hono();
        api.route('/api', router);
        kernel.getApp().route('/', api);
        app = kernel.getApp();
    });

    afterAll(async () => {
        await kernel?.shutdown();
        await sql.unsafe(DROP);
        await sql.end({ timeout: 5 });
    });

    const post = (path: string, body: unknown) =>
        app.request(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
            body: JSON.stringify(body),
        });

    it('rejects admin routes without a session', async () => {
        expect((await app.request('/api/spaces')).status).toBe(401);
        expect((await app.request('/api/forms/x/answers')).status).toBe(401);
    });

    it('does not allow public sign-up', async () => {
        const res = await post('/api/auth/sign-up/email', {
            email: 'mallory@example.com',
            password: 'correct-horse-battery-staple',
            name: 'Mallory',
        });
        expect(res.ok).toBe(false);
        expect(await sql`SELECT 1 FROM "user" WHERE email = 'mallory@example.com'`).toHaveLength(0);
    });

    it('lets the provisioned admin sign in and use the API', async () => {
        const res = await post('/api/auth/sign-in/email', {
            email: 'admin@example.com',
            password: 'correct-horse-battery-staple',
        });
        expect(res.status).toBe(200);
        const cookie = res.headers
            .getSetCookie()
            .map((c) => c.split(';')[0])
            .join('; ');

        const spaces = await app.request('/api/spaces', { headers: { Cookie: cookie } });
        expect(spaces.status).toBe(200);
    });
});
