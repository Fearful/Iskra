import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { sql } from 'drizzle-orm';
import { integer, sqliteTable } from 'drizzle-orm/sqlite-core';
import { App } from '@iskra-bun/core';
import { DbDriver } from '../src/driver';
import { QueryError } from '../src/errors';

// Drizzle's bun-sqlite transaction() is synchronous: with an async callback it
// committed before the callback's awaits ran, so a later throw rolled nothing
// back.

const t = sqliteTable('t', { id: integer('id') });

let app: App;
let driver: DbDriver;
let db: any;

beforeEach(async () => {
    app = new App({ name: 'SqliteTx', logger: { level: 'silent' }, db: { driver: 'sqlite', url: ':memory:' } } as any);
    driver = new DbDriver();
    app.register(driver);
    await app.start();
    db = driver.db;
    db.run(sql`CREATE TABLE t (id INTEGER)`);
});

afterEach(async () => {
    await app.stop();
});

const ids = () => db.all(sql`SELECT id FROM t ORDER BY id`).map((r: { id: number }) => r.id);

describe('DbDriver.transaction with sqlite', () => {
    test('rolls back when the async callback throws after awaiting', async () => {
        await expect(
            driver.transaction(async (tx: any) => {
                await tx.insert(t).values({ id: 1 });
                await Bun.sleep(1);
                await tx.insert(t).values({ id: 2 });
                throw new Error('boom');
            }),
        ).rejects.toBeInstanceOf(QueryError);
        expect(ids()).toEqual([]);
    });

    test('rolls back on tx.rollback()', async () => {
        await expect(
            driver.transaction(async (tx: any) => {
                await tx.insert(t).values({ id: 1 });
                tx.rollback();
            }),
        ).rejects.toBeInstanceOf(QueryError);
        expect(ids()).toEqual([]);
    });

    test('commits and returns the callback result', async () => {
        const result = await driver.transaction(async (tx: any) => {
            await tx.insert(t).values({ id: 1 });
            await Bun.sleep(1);
            await tx.insert(t).values({ id: 2 });
            return 'done';
        });
        expect(result).toBe('done');
        expect(ids()).toEqual([1, 2]);
    });

    test('runs concurrent transactions one at a time', async () => {
        const failing = driver.transaction(async (tx: any) => {
            await tx.insert(t).values({ id: 1 });
            await Bun.sleep(20);
            throw new Error('boom');
        });
        const succeeding = driver.transaction(async (tx: any) => {
            await tx.insert(t).values({ id: 2 });
        });
        await expect(failing).rejects.toBeInstanceOf(QueryError);
        await succeeding;
        // The second one's insert is not swept into the first one's rollback.
        expect(ids()).toEqual([2]);
    });

    test('rejects a nested transaction() instead of waiting for itself', async () => {
        await expect(
            driver.transaction(async () => {
                await driver.transaction(async () => 1);
            }),
        ).rejects.toThrow(/Nested transaction/);
        // The connection is usable afterwards.
        await driver.transaction(async (tx: any) => {
            await tx.insert(t).values({ id: 3 });
        });
        expect(ids()).toEqual([3]);
    });
});
