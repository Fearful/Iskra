import { sql } from 'drizzle-orm';
import type { App } from '@iskra-bun/core';
import type { Db } from './types.ts';
import { ProductService } from '../domain/products/product.service.ts';
import { OrderService } from '../domain/orders/order.service.ts';

/** One statement each: Drizzle's run() executes a single statement. */
const TABLES = [
    `CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        price REAL NOT NULL,
        stock INTEGER NOT NULL,
        created_at INTEGER DEFAULT (unixepoch()),
        updated_at INTEGER DEFAULT (unixepoch())
    )`,
    `CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        total REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER DEFAULT (unixepoch())
    )`,
    `CREATE TABLE IF NOT EXISTS order_items (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        price REAL NOT NULL,
        FOREIGN KEY(order_id) REFERENCES orders(id),
        FOREIGN KEY(product_id) REFERENCES products(id)
    )`,
];

/**
 * Creates the tables and hands the database to the services. Call it after
 * `app.start()` (DbDriver connects in start()); throws when there is no DB.
 */
export function setupDatabase(app: App): Db {
    const handle = app.context.get('db')?.db;
    // Fail the start instead of serving every request without a database.
    if (!handle) throw new Error('DB Driver not initialized');
    // This template's database is SQLite (app.config.ts), so the handle is
    // Drizzle's bun:sqlite one.
    return initDatabase(handle as Db);
}

/** Creates the tables in `db` and hands it to the services. */
export function initDatabase(db: Db): Db {
    for (const ddl of TABLES) db.run(sql.raw(ddl));
    ProductService.setDb(db);
    OrderService.setDb(db);
    return db;
}
