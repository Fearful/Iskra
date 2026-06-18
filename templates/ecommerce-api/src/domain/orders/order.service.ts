import { Order, CreateOrderInput } from './order.model.ts';
import { ProductService } from '../products/product.service.ts';
import { orders, orderItems, products } from '../../db/schema.ts';
import { eq, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

export class OrderService {
    private static db: any;

    static setDb(db: any) {
        this.db = db;
    }

    static async create(input: CreateOrderInput): Promise<Order> {
        return this.db.transaction(async (tx: any) => {
            // Use tx for transactional operations
            // We need to pass tx to ProductService or duplicate logic?
            // ProductService.decreaseStock uses this.db.
            // If we want it to be part of transaction, we need to allow injecting tx or context.
            // For now, let's just use ProductService as is (non-transactional across services implies risk but simpler for this task).
            // OR simpler: just replicate check logic here and update products directly via tx?
            // Replicating logic is safer for transaction integrity.

            let total = 0;
            const itemsToInsert: any[] = [];

            for (const item of input.items) {
                const product = await ProductService.findById(item.productId, tx);
                if (!product) {
                    throw new Error(`Product ${item.productId} not found`);
                }
                if (product.stock < item.quantity) {
                    throw new Error(`Insufficient stock for product ${product.name}`);
                }
                total += product.price * item.quantity;

                itemsToInsert.push({
                    id: uuidv4(),
                    orderId: '', // set later
                    productId: item.productId,
                    quantity: item.quantity,
                    price: product.price
                });
            }

            // Decrease stock
            for (const item of input.items) {
                await ProductService.decreaseStock(item.productId, item.quantity, tx);
            }

            const orderId = uuidv4();
            const order: Order = {
                id: orderId,
                userId: input.userId,
                items: input.items, // Logic keeps input items structure, but we insert full items to DB
                total,
                status: 'pending',
                createdAt: new Date(),
            };

            await tx.insert(orders).values({
                id: order.id,
                userId: order.userId,
                total: order.total,
                status: order.status,
                createdAt: order.createdAt
            }).run();

            for (const item of itemsToInsert) {
                item.orderId = orderId;
                await tx.insert(orderItems).values(item).run();
            }

            return order;
        });
    }

    static async findAll(): Promise<Order[]> {
        if (!this.db) return [];
        const allOrders = await this.db.select().from(orders).all();

        // Populate items
        for (const order of allOrders) {
            const items = await this.db.select().from(orderItems).where(eq(orderItems.orderId, order.id)).all();
            order.items = items.map((i: any) => ({
                productId: i.productId,
                quantity: i.quantity
            }));
        }
        return allOrders;
    }
}
