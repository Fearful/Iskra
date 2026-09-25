import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ProductService } from '../src/domain/products/product.service';
import { OrderService } from '../src/domain/orders/order.service';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Database } from 'bun:sqlite';

describe('Ecommerce Domain Logic', () => {
    let db: any;
    let client: any;

    beforeEach(() => {
        client = new Database(':memory:');
        db = drizzle(client);

        // Create tables manually
        // bun:sqlite uses .run() instead of .exec() for statements? Or .exec()?
        // checking docs: db.run(sql), db.exec(sql) executes script.
        client.exec(`
            CREATE TABLE products (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                price REAL NOT NULL,
                stock INTEGER NOT NULL,
                created_at INTEGER DEFAULT (unixepoch()),
                updated_at INTEGER DEFAULT (unixepoch())
            );
            CREATE TABLE orders (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                total REAL NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at INTEGER DEFAULT (unixepoch())
            );
            CREATE TABLE order_items (
                id TEXT PRIMARY KEY,
                order_id TEXT NOT NULL,
                product_id TEXT NOT NULL,
                quantity INTEGER NOT NULL,
                price REAL NOT NULL,
                FOREIGN KEY(order_id) REFERENCES orders(id),
                FOREIGN KEY(product_id) REFERENCES products(id)
            );
        `);

        ProductService.setDb(db);
        OrderService.setDb(db);
    });

    afterEach(() => {
        client.close();
    });

    it('should create a product and decrease stock', async () => {
        const product = await ProductService.create({
            name: 'Test Product',
            price: 100,
            stock: 10,
            description: 'Test Desc',
        });

        expect(product).toBeDefined();
        expect(product.id).toBeDefined();
        expect(product.stock).toBe(10);

        await ProductService.decreaseStock(product.id, 2);

        const updated = await ProductService.findById(product.id);
        expect(updated?.stock).toBe(8);
    });

    it('should create an order and update product stock', async () => {
        const p1 = await ProductService.create({ name: 'P1', price: 50, stock: 5 });
        const p2 = await ProductService.create({ name: 'P2', price: 30, stock: 10 });

        const order = await OrderService.create('user-123', {
            items: [
                { productId: p1.id, quantity: 2 },
                { productId: p2.id, quantity: 1 },
            ],
        });

        expect(order).toBeDefined();
        expect(order.total).toBe(130); // 50*2 + 30*1

        const updatedP1 = await ProductService.findById(p1.id);
        expect(updatedP1?.stock).toBe(3); // 5 - 2

        const updatedP2 = await ProductService.findById(p2.id);
        expect(updatedP2?.stock).toBe(9); // 10 - 1
    });

    it('should fail to create order if insufficient stock', async () => {
        const p1 = await ProductService.create({ name: 'P1', price: 50, stock: 1 });

        // Expect promise to reject
        let error: any;
        try {
            await OrderService.create('user-123', {
                items: [{ productId: p1.id, quantity: 2 }],
            });
        } catch (e) {
            error = e;
        }

        expect(error).toBeDefined();
        expect(error.message).toContain('Insufficient stock');

        // Stock should remain unchanged (transaction rolled back? logic throws before decreasing actually)
        // My implementation in OrderService checks first, then decreases.
        // If it fails on check, no decrease happens.

        const updatedP1 = await ProductService.findById(p1.id);
        expect(updatedP1?.stock).toBe(1);
    });
});
