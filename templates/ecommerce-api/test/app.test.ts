import { describe, it, expect, afterAll } from 'bun:test';
import { App } from '@iskra-bun/core';
import { WebPlugin } from '@iskra-bun/web-kit';
import { DbDriver } from '@iskra-bun/db-kit';
import productRouter from '../src/interfaces/http/router.ts';
import { ProductService } from '../src/domain/products/product.service.ts';
import { OrderService } from '../src/domain/orders/order.service.ts';
import { Hono } from 'hono';

const TEST_PORT = 3321;

describe('Ecommerce API App', () => {
    let app: App;

    it('should start and serve requests', async () => {
        app = new App({
            name: 'EcommerceAPITest',
            logger: { level: 'error' },
            db: { driver: 'sqlite', url: ':memory:' },
        });

        const router = new Hono();
        router.route('/api', productRouter);

        app.register(new DbDriver());
        app.register(
            new WebPlugin({
                port: TEST_PORT,
                router: router,
            }),
        );

        await app.start();

        // Set up DB tables and inject into services
        const dbDriver = app.context.get('db');
        const client = dbDriver.client;
        client.exec(`
            CREATE TABLE IF NOT EXISTS products (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                price REAL NOT NULL,
                stock INTEGER NOT NULL,
                created_at INTEGER DEFAULT (unixepoch()),
                updated_at INTEGER DEFAULT (unixepoch())
            );
            CREATE TABLE IF NOT EXISTS orders (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                total REAL NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at INTEGER DEFAULT (unixepoch())
            );
            CREATE TABLE IF NOT EXISTS order_items (
                id TEXT PRIMARY KEY,
                order_id TEXT NOT NULL,
                product_id TEXT NOT NULL,
                quantity INTEGER NOT NULL,
                price REAL NOT NULL,
                FOREIGN KEY(order_id) REFERENCES orders(id),
                FOREIGN KEY(product_id) REFERENCES products(id)
            );
        `);
        ProductService.setDb(dbDriver.db);
        OrderService.setDb(dbDriver.db);

        const response = await fetch(`http://localhost:${TEST_PORT}/api/products`);
        expect(response.status).toBe(200);

        const data = await response.json();
        expect(Array.isArray(data)).toBe(true);
    });

    afterAll(async () => {
        if (app) await app.stop();
    });
});
