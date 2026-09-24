import { Order, CreateOrderInput } from './order.model.ts';
import { orders, orderItems, products } from '../../db/schema.ts';
import { eq, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import type { Db } from '../../db/types.ts';

export class OrderService {
    private static db: Db;

    static setDb(db: Db) {
        this.db = db;
    }

    /**
     * Checks and takes the stock and records the order in one transaction.
     *
     * bun:sqlite transactions are synchronous: with an async callback, Drizzle
     * committed as soon as the callback returned its promise, so a later
     * "insufficient stock" rolled nothing back and a rejected order kept the
     * stock it had already taken. Every statement here runs synchronously
     * inside the transaction, and the quantities of repeated products are
     * added up before checking (each line alone used to pass).
     */
    static async create(input: CreateOrderInput): Promise<Order> {
        return this.db.transaction((tx) => {
            const quantities = new Map<string, number>();
            for (const item of input.items) {
                quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
            }

            const prices = new Map<string, number>();
            for (const [productId, quantity] of quantities) {
                const product = tx.select().from(products).where(eq(products.id, productId)).get();
                if (!product) {
                    throw new Error(`Product ${productId} not found`);
                }
                if (product.stock < quantity) {
                    throw new Error(`Insufficient stock for product ${product.name}`);
                }
                prices.set(productId, product.price);
            }

            for (const [productId, quantity] of quantities) {
                tx.update(products)
                    .set({ stock: sql`${products.stock} - ${quantity}`, updatedAt: new Date() })
                    .where(eq(products.id, productId))
                    .run();
            }

            const orderId = uuidv4();
            const total = input.items.reduce((sum, item) => sum + prices.get(item.productId)! * item.quantity, 0);
            const order: Order = {
                id: orderId,
                userId: input.userId,
                items: input.items,
                total,
                status: 'pending',
                createdAt: new Date(),
            };

            tx.insert(orders).values({
                id: order.id,
                userId: order.userId,
                total: order.total,
                status: order.status,
                createdAt: order.createdAt,
            }).run();

            for (const item of input.items) {
                tx.insert(orderItems).values({
                    id: uuidv4(),
                    orderId,
                    productId: item.productId,
                    quantity: item.quantity,
                    price: prices.get(item.productId)!,
                }).run();
            }

            return order;
        });
    }

    static async findAll(): Promise<Order[]> {
        if (!this.db) return [];
        return this.db.select().from(orders).all().map((row) => ({
            id: row.id,
            userId: row.userId,
            total: row.total,
            // Only create() writes it, with one of the model's statuses.
            status: row.status as Order['status'],
            createdAt: row.createdAt ?? undefined,
            items: this.db
                .select()
                .from(orderItems)
                .where(eq(orderItems.orderId, row.id))
                .all()
                .map((i) => ({ productId: i.productId, quantity: i.quantity })),
        }));
    }
}
