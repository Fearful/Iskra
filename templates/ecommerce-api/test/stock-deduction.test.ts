import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ProductService } from '../src/domain/products/product.service';
import { OrderService } from '../src/domain/orders/order.service';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Database } from 'bun:sqlite';

describe('Ecommerce API - Stock Deduction', () => {
    let client: any;
    let db: any;

    beforeEach(() => {
        client = new Database(':memory:');
        db = drizzle(client);

        client.exec(`
            CREATE TABLE products (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
                price REAL NOT NULL, stock INTEGER NOT NULL,
                created_at INTEGER DEFAULT (unixepoch()), updated_at INTEGER DEFAULT (unixepoch())
            );
            CREATE TABLE orders (
                id TEXT PRIMARY KEY, user_id TEXT NOT NULL, total REAL NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER DEFAULT (unixepoch())
            );
            CREATE TABLE order_items (
                id TEXT PRIMARY KEY, order_id TEXT NOT NULL, product_id TEXT NOT NULL,
                quantity INTEGER NOT NULL, price REAL NOT NULL,
                FOREIGN KEY(order_id) REFERENCES orders(id), FOREIGN KEY(product_id) REFERENCES products(id)
            );
        `);

        ProductService.setDb(db);
        OrderService.setDb(db);
    });

    afterEach(() => {
        client.close();
    });

    it('should decrease stock when order is created', async () => {
        const product = await ProductService.create({
            name: 'Test Product',
            price: 100,
            stock: 10,
            description: 'Test Description'
        });

        await OrderService.create({
            userId: 'user-1',
            items: [{ productId: product.id, quantity: 2 }]
        });

        const updatedProduct = await ProductService.findById(product.id);
        expect(updatedProduct?.stock).toBe(8);
    });

    it('should throw error if insufficient stock', async () => {
        const product = await ProductService.create({
            name: 'Limited Product',
            price: 50,
            stock: 1,
            description: 'Limited'
        });

        let error: any;
        try {
            await OrderService.create({
                userId: 'user-2',
                items: [{ productId: product.id, quantity: 2 }]
            });
        } catch (e) {
            error = e;
        }

        expect(error).toBeDefined();
        expect(error.message).toContain('Insufficient stock');

        const updatedProduct = await ProductService.findById(product.id);
        expect(updatedProduct?.stock).toBe(1);
    });
});
