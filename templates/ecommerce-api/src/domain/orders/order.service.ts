import { Order, CreateOrderInput } from './order.model.ts';
import { orders, orderItems, products } from '../../db/schema.ts';
import { eq, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import type { Db } from '../../db/types.ts';

/** Un rechazo de la orden que el cliente puede leer (producto inexistente, sin stock). */
export class OrderError extends Error {
    override name = 'OrderError';
}

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
     *
     * `userId` is the authenticated caller's, never a field of the request.
     */
    static async create(userId: string, input: CreateOrderInput): Promise<Order> {
        return this.db.transaction((tx) => {
            const quantities = new Map<string, number>();
            for (const item of input.items) {
                quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
            }

            const prices = new Map<string, number>();
            for (const [productId, quantity] of quantities) {
                const product = tx.select().from(products).where(eq(products.id, productId)).get();
                if (!product) {
                    throw new OrderError(`Product ${productId} not found`);
                }
                if (product.stock < quantity) {
                    throw new OrderError(`Insufficient stock for product ${product.name}`);
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
                userId,
                items: input.items,
                total,
                status: 'pending',
                createdAt: new Date(),
            };

            tx.insert(orders)
                .values({
                    id: order.id,
                    userId: order.userId,
                    total: order.total,
                    status: order.status,
                    createdAt: order.createdAt,
                })
                .run();

            for (const item of input.items) {
                tx.insert(orderItems)
                    .values({
                        id: uuidv4(),
                        orderId,
                        productId: item.productId,
                        quantity: item.quantity,
                        price: prices.get(item.productId)!,
                    })
                    .run();
            }

            return order;
        });
    }

    /** Every order: only for admins (see the router). */
    static async findAll(): Promise<Order[]> {
        if (!this.db) return [];
        return this.toOrders(this.db.select().from(orders).all());
    }

    /** The orders of one user. */
    static async findByUser(userId: string): Promise<Order[]> {
        if (!this.db) return [];
        return this.toOrders(this.db.select().from(orders).where(eq(orders.userId, userId)).all());
    }

    private static toOrders(rows: (typeof orders.$inferSelect)[]): Order[] {
        return rows.map((row) => ({
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
