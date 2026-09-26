import { describe, it, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Kernel } from '../src/kernel';
import { SessionFeature } from '../src/features/session';
import { DbFeature } from '../src/features/db';
import type { Feature } from '../src/types';

// End-to-end exercise of the DB-backed session store across all three dialects.
// sqlite runs locally (bun:sqlite, in-memory); postgres/mysql are gated behind a
// real, credential-checked connection. Override servers with TEST_PG_URL /
// TEST_MYSQL_URL (note: this machine's native PG on 5432 — use 5433 for the test
// container).
const PG_URL = process.env.TEST_PG_URL || 'postgres://postgres:postgres@127.0.0.1:5432/postgres';
const MYSQL_URL = process.env.TEST_MYSQL_URL || 'mysql://root:mysql@127.0.0.1:3306/test';

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

async function mysqlUsable(url: string): Promise<boolean> {
    try {
        const mysql = (await import('mysql2/promise')).default;
        const conn = await mysql.createConnection(url);
        try {
            await conn.query('SELECT 1');
            return true;
        } finally {
            await conn.end();
        }
    } catch {
        return false;
    }
}

const pgUp = await pgUsable(PG_URL);
const mysqlUp = await mysqlUsable(MYSQL_URL);

async function build(dbConfig: any) {
    const kernel = new Kernel();
    kernel.registerFeature(new DbFeature(dbConfig));
    kernel.registerFeature(
        new SessionFeature({ store: 'db', secret: 'db-session-secret-0123456789abcdef0123456789abcdef' }),
    );
    await kernel.initialize();

    const app = kernel.getApp();
    app.get('/set', (c) => {
        c.get('session').value = c.req.query('v') ?? 'x';
        return c.json({ ok: true });
    });
    app.get('/get', (c) => c.json({ session: c.get('session') }));
    // Logout by clearing the data instead of calling destroySession().
    app.get('/clear', (c) => {
        delete c.get('session').value;
        return c.json({ ok: true });
    });
    // Deliberately does NOT clear the in-memory session — destroySession() alone
    // must prevent the post-response save block from re-persisting it.
    app.get('/logout', async (c) => {
        await c.get('destroySession')();
        return c.json({ ok: true });
    });
    return kernel;
}

function cookieOf(res: Response): string {
    return res.headers.get('Set-Cookie')!.split(';')[0];
}

function runSuite(enabled: boolean, label: string, dbConfig: any) {
    (enabled ? describe : describe.skip)(label, () => {
        it('persists and restores a session across requests', async () => {
            const kernel = await build(dbConfig);
            const app = kernel.getApp();

            const cookie = cookieOf(await app.request('/set?v=hello'));
            const got = (await (await app.request('/get', { headers: { Cookie: cookie } })).json()) as any;
            expect(got.session.value).toBe('hello');

            await kernel.shutdown();
        });

        it('saves changes to an existing session', async () => {
            const kernel = await build(dbConfig);
            const app = kernel.getApp();

            const cookie = cookieOf(await app.request('/set?v=first'));
            await app.request('/set?v=second', { headers: { Cookie: cookie } });
            const got = (await (await app.request('/get', { headers: { Cookie: cookie } })).json()) as any;
            expect(got.session.value).toBe('second');

            await kernel.shutdown();
        });

        it('destroys a session', async () => {
            const kernel = await build(dbConfig);
            const app = kernel.getApp();

            const cookie = cookieOf(await app.request('/set?v=bye'));
            await app.request('/logout', { headers: { Cookie: cookie } });

            const after = (await (await app.request('/get', { headers: { Cookie: cookie } })).json()) as any;
            expect(after.session).toEqual({});

            await kernel.shutdown();
        });

        it('forgets a session the handler emptied', async () => {
            const kernel = await build(dbConfig);
            const app = kernel.getApp();

            const cookie = cookieOf(await app.request('/set?v=gone'));
            await app.request('/clear', { headers: { Cookie: cookie } });

            const after = (await (await app.request('/get', { headers: { Cookie: cookie } })).json()) as any;
            expect(after.session).toEqual({});

            await kernel.shutdown();
        });

        it('stores values with SQL metacharacters safely (no injection)', async () => {
            const kernel = await build(dbConfig);
            const app = kernel.getApp();

            const evil = "'); DROP TABLE sessions;--";
            const cookie = cookieOf(await app.request(`/set?v=${encodeURIComponent(evil)}`));
            const got = (await (await app.request('/get', { headers: { Cookie: cookie } })).json()) as any;
            expect(got.session.value).toBe(evil);

            // The table must still exist and work afterwards.
            const cookie2 = cookieOf(await app.request('/set?v=after'));
            const got2 = (await (await app.request('/get', { headers: { Cookie: cookie2 } })).json()) as any;
            expect(got2.session.value).toBe('after');

            await kernel.shutdown();
        });
    });
}

runSuite(true, 'DB session store — sqlite (local)', { adapter: 'sqlite', connection: { database: ':memory:' } });

describe('DB session store — concurrent logout', () => {
    it('a save does not re-create a session deleted just before its write', async () => {
        // Regression: the save checked the row (SELECT) and then upserted it
        // (DELETE + INSERT), so a logout committed in between was undone.
        const sqlite = new Database(':memory:');
        let beforeWrite: (() => void) | undefined;
        const db = drizzle(sqlite, {
            logger: {
                // Called right before each statement runs.
                logQuery(query) {
                    if (!beforeWrite || !/^(update|insert|delete)\b/i.test(query)) return;
                    const run = beforeWrite;
                    beforeWrite = undefined;
                    run();
                },
            },
        });
        const kernel = new Kernel({ logger: false });
        kernel.registerFeature({ name: 'db', db, adapter: 'sqlite', async initialize() {} } as Feature);
        kernel.registerFeature(
            new SessionFeature({ store: 'db', secret: 'db-session-secret-0123456789abcdef0123456789abcdef' }),
        );
        await kernel.initialize();
        const app = kernel.getApp();
        app.get('/set', (c) => {
            c.get('session').value = c.req.query('v') ?? 'x';
            return c.json({ ok: true });
        });
        app.get('/get', (c) => c.json({ session: c.get('session') }));

        const cookie = cookieOf(await app.request('/set?v=logged-in'));
        // Another request's logout commits while this save is under way.
        beforeWrite = () => sqlite.run('DELETE FROM sessions');
        await app.request('/set?v=still-here', { headers: { Cookie: cookie } });

        const after = (await (await app.request('/get', { headers: { Cookie: cookie } })).json()) as any;
        expect(after.session).toEqual({});
        await kernel.shutdown();
    });
});
describe('DB session store — write failures', () => {
    it('answers 500 with no cookie when the session cannot be stored', async () => {
        // Regression: the store logged the error and went on, so the client
        // got a cookie for a session that was never saved.
        const sqlite = new Database(':memory:');
        let failInsert = false;
        const db = drizzle(sqlite, {
            logger: {
                // Called right before each statement runs.
                logQuery(query) {
                    if (failInsert && /^insert\b/i.test(query)) throw new Error('disk full');
                },
            },
        });
        const kernel = new Kernel({ logger: false });
        kernel.registerFeature({ name: 'db', db, adapter: 'sqlite', async initialize() {} } as Feature);
        kernel.registerFeature(
            new SessionFeature({ store: 'db', secret: 'db-session-secret-0123456789abcdef0123456789abcdef' }),
        );
        await kernel.initialize();
        const app = kernel.getApp();
        app.get('/set', (c) => {
            c.get('session').value = 'x';
            return c.json({ ok: true });
        });

        failInsert = true;
        const res = await app.request('/set');
        expect(res.status).toBe(500);
        expect(res.headers.get('Set-Cookie')).toBeNull();
        await kernel.shutdown();
    });
});

describe('DB session store — read failures', () => {
    async function setup() {
        const sqlite = new Database(':memory:');
        let failSelect = false;
        const db = drizzle(sqlite, {
            logger: {
                logQuery(query) {
                    if (failSelect && /^select\b/i.test(query)) throw new Error('connection lost');
                },
            },
        });
        const kernel = new Kernel({ logger: false });
        kernel.registerFeature({ name: 'db', db, adapter: 'sqlite', async initialize() {} } as Feature);
        kernel.registerFeature(
            new SessionFeature({ store: 'db', secret: 'db-session-secret-0123456789abcdef0123456789abcdef' }),
        );
        await kernel.initialize();
        const app = kernel.getApp();
        app.get('/set', (c) => {
            c.get('session').value = 'x';
            return c.json({ ok: true });
        });
        app.get('/get', (c) => c.json({ session: c.get('session') }));
        return { sqlite, kernel, app, failSelects: () => (failSelect = true) };
    }

    it('treats a corrupt row as no session', async () => {
        // Regression: the parse error was rethrown with the database errors,
        // so the request failed (500) until the row expired.
        const { sqlite, kernel, app } = await setup();
        const cookie = cookieOf(await app.request('/set'));
        sqlite.run(`UPDATE sessions SET data = '{not json'`);

        const res = await app.request('/get', { headers: { Cookie: cookie } });
        expect(res.status).toBe(200);
        expect(((await res.json()) as any).session).toEqual({});
        await kernel.shutdown();
    });

    it('still fails the request when the database cannot be read', async () => {
        const { kernel, app, failSelects } = await setup();
        const cookie = cookieOf(await app.request('/set'));
        failSelects();

        expect((await app.request('/get', { headers: { Cookie: cookie } })).status).toBe(500);
        await kernel.shutdown();
    });
});

runSuite(pgUp, 'DB session store — postgres (requires Postgres)', {
    adapter: 'postgres',
    connection: { connectionString: PG_URL },
});
runSuite(mysqlUp, 'DB session store — mysql (requires MySQL)', {
    adapter: 'mysql',
    connection: { connectionString: MYSQL_URL },
});
