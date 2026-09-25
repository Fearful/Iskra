import { describe, test, expect } from 'bun:test';
import { DbDriver } from '../src/driver';
import { App } from '@iskra-bun/core';

// Real connection paths for the DbDriver switch. libsql runs locally (no server
// needed); postgres and mysql are gated behind a server that actually accepts
// our credentials so the suite stays infra-free otherwise. The gate performs a
// real connection (not just a TCP probe) so an unrelated server on the same port
// — e.g. a native Postgres on 5432 — causes a clean skip rather than a failure.
// Override with TEST_PG_URL / TEST_MYSQL_URL.
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

describe('DbDriver libsql connection', () => {
    test('connects to a local libsql database and exposes a usable client', async () => {
        const app = new App({
            name: 'LibsqlTest',
            logger: { level: 'error' },
            db: { driver: 'libsql', url: ':memory:' },
        });
        const driver = new DbDriver();
        app.register(driver);
        await app.start();

        expect(driver.db).toBeDefined();
        const client = (driver as any).client;
        const res = await client.execute('SELECT 1 + 1 AS sum');
        expect(Number(res.rows[0].sum)).toBe(2);

        await app.stop();
    });
});

describe.if(pgUp)('DbDriver postgres connection (requires Postgres)', () => {
    test('connects and runs a query through the postgres client', async () => {
        const app = new App({
            name: 'PostgresTest',
            logger: { level: 'error' },
            db: { driver: 'postgres', url: PG_URL },
        });
        const driver = new DbDriver();
        app.register(driver);
        await app.start();

        expect(driver.db).toBeDefined();
        const sql = (driver as any).client; // postgres.js tagged-template client
        const rows = await sql`SELECT 1 + 1 AS sum`;
        expect(Number(rows[0].sum)).toBe(2);

        await app.stop();
    });
});

describe.if(mysqlUp)('DbDriver mysql connection (requires MySQL)', () => {
    test('connects and runs a query through the mysql client', async () => {
        const app = new App({
            name: 'MysqlTest',
            logger: { level: 'error' },
            db: { driver: 'mysql', url: MYSQL_URL },
        });
        const driver = new DbDriver();
        app.register(driver);
        await app.start();

        expect(driver.db).toBeDefined();
        const conn = (driver as any).client; // mysql2 connection
        const [rows] = await conn.query('SELECT 1 + 1 AS sum');
        expect(Number(rows[0].sum)).toBe(2);

        await app.stop();
    });
});
