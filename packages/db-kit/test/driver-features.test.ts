import { describe, test, expect } from 'bun:test';
import { DbDriver } from '../src/driver';
import { QueryError } from '../src/errors';
import { App } from '@iskra-bun/core';

// Increment D additive features: transaction(), onQuery hook, ping().
// All exercised against the in-memory sqlite path used elsewhere in the suite.

async function sqliteDriver() {
    const app = new App({
        name: 'FeaturesTest',
        logger: { level: 'error' },
        db: { driver: 'sqlite', url: ':memory:' },
    });
    const driver = new DbDriver();
    app.register(driver);
    await app.start();
    return { app, driver };
}

describe('DbDriver.transaction', () => {
    test("delegates to drizzle's transaction and returns the callback result", async () => {
        const { app, driver } = await sqliteDriver();
        // Seed a table through the raw client so the tx has something to read.
        const client = (driver as any).client;
        client.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, n INTEGER)');
        client.exec('INSERT INTO t (n) VALUES (41)');

        const result = await driver.transaction(async (tx) => {
            // tx is the same dialect db handle; prove it is passed through.
            expect(tx).toBeDefined();
            return 42;
        });
        expect(result).toBe(42);
        await app.stop();
    });

    test('throws when called before the driver is started', async () => {
        const driver = new DbDriver();
        await expect(driver.transaction(async () => 1)).rejects.toBeInstanceOf(QueryError);
    });
});

describe('DbDriver onQuery hook', () => {
    test('onQuery receives the SQL string for an executed statement', async () => {
        const seen: string[] = [];
        const app = new App({
            name: 'OnQueryTest',
            logger: { level: 'error' },
            db: { driver: 'sqlite', url: ':memory:' },
        });
        const driver = new DbDriver();
        driver.setOnQuery((query) => {
            seen.push(query);
        });
        app.register(driver);
        await app.start();

        // Run a statement through Drizzle so its logger fires.
        const { sql } = await import('drizzle-orm');
        await (driver.db as any).run(sql`SELECT 1`);

        expect(seen.length).toBeGreaterThan(0);
        expect(seen.some((q) => /select/i.test(q))).toBe(true);
        await app.stop();
    });

    test('setOnQuery before start wires the logger adapter without throwing on a faulty callback', async () => {
        const app = new App({
            name: 'OnQueryFaultTest',
            logger: { level: 'error' },
            db: { driver: 'sqlite', url: ':memory:' },
        });
        const driver = new DbDriver();
        driver.setOnQuery(() => {
            throw new Error('observer boom');
        });
        app.register(driver);
        await app.start();

        const { sql } = await import('drizzle-orm');
        // A throwing observer must not break the underlying query.
        await (driver.db as any).run(sql`SELECT 1`);
        expect(driver.db).toBeDefined();
        await app.stop();
    });
});

describe('DbDriver.ping', () => {
    test('returns true against a live in-memory database', async () => {
        const { app, driver } = await sqliteDriver();
        expect(await driver.ping()).toBe(true);
        await app.stop();
    });

    test('returns false (never rejects) when there is no live db', async () => {
        const driver = new DbDriver();
        // start() never ran → db is undefined → ping should resolve false.
        await expect(driver.ping()).resolves.toBe(false);
    });
});
