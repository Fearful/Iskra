import { Product, CreateProductInput } from './product.model.ts';
import { products } from '../../db/schema.ts';
import { eq, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import type { Db, Tx } from '../../db/types.ts';

/** A products row as the model: SQL NULLs become absent optional fields. */
function toProduct(row: typeof products.$inferSelect): Product {
    return {
        id: row.id,
        name: row.name,
        price: row.price,
        stock: row.stock,
        description: row.description ?? undefined,
        createdAt: row.createdAt ?? undefined,
        updatedAt: row.updatedAt ?? undefined,
    };
}

export class ProductService {
    private static db: Db;

    static setDb(db: Db) {
        this.db = db;
    }

    static async findAll(): Promise<Product[]> {
        return this.db.select().from(products).all().map(toProduct);
    }

    static async findById(id: string, tx?: Tx): Promise<Product | undefined> {
        const executor = tx || this.db;
        const row = executor.select().from(products).where(eq(products.id, id)).get();
        return row ? toProduct(row) : undefined;
    }

    static async create(input: CreateProductInput): Promise<Product> {
        const product: Product = {
            id: uuidv4(),
            ...input,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        this.db.insert(products).values(product).run();
        return product;
    }

    static async checkStock(id: string, quantity: number, tx?: Tx): Promise<void> {
        const product = await this.findById(id, tx);
        if (!product) {
            throw new Error(`Product ${id} not found`);
        }
        if (product.stock < quantity) {
            throw new Error(`Insufficient stock for product ${product.name}`);
        }
    }

    static async decreaseStock(id: string, quantity: number, tx?: Tx): Promise<void> {
        await this.checkStock(id, quantity, tx);
        const executor = tx || this.db;
        executor
            .update(products)
            .set({
                stock: sql`${products.stock} - ${quantity}`,
                updatedAt: new Date(),
            })
            .where(eq(products.id, id))
            .run();
    }
}
