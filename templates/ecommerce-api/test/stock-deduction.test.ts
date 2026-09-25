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
            description: 'Test Description',
        });

        await OrderService.create('user-1', {
            items: [{ productId: product.id, quantity: 2 }],
        });

        const updatedProduct = await ProductService.findById(product.id);
        expect(updatedProduct?.stock).toBe(8);
    });

    it('should throw error if insufficient stock', async () => {
        const product = await ProductService.create({
            name: 'Limited Product',
            price: 50,
            stock: 1,
            description: 'Limited',
        });

        let error: any;
        try {
            await OrderService.create('user-2', {
                items: [{ productId: product.id, quantity: 2 }],
            });
        } catch (e) {
            error = e;
        }

        expect(error).toBeDefined();
        expect(error.message).toContain('Insufficient stock');

        const updatedProduct = await ProductService.findById(product.id);
        expect(updatedProduct?.stock).toBe(1);
    });

    it('leaves the stock untouched when an order is rejected', async () => {
        const product = await ProductService.create({ name: 'Widget', price: 10, stock: 10, description: '' });
        const other = await ProductService.create({ name: 'Gadget', price: 5, stock: 1, description: '' });

        // The same product twice (4 + 7 > 10), and a second product short of stock.
        await expect(
            OrderService.create('u', {
                items: [
                    { productId: product.id, quantity: 4 },
                    { productId: product.id, quantity: 7 },
                ],
            }),
        ).rejects.toThrow(/Insufficient stock/);
        await expect(
            OrderService.create('u', {
                items: [
                    { productId: product.id, quantity: 4 },
                    { productId: other.id, quantity: 2 },
                ],
            }),
        ).rejects.toThrow(/Insufficient stock/);

        // The first line's stock used to be taken anyway (the async callback's
        // transaction had already committed).
        expect((await ProductService.findById(product.id))?.stock).toBe(10);
        expect((await ProductService.findById(other.id))?.stock).toBe(1);
        expect(client.query('SELECT count(*) AS c FROM orders').get().c).toBe(0);
    });
});
