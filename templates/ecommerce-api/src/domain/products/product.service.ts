import { Product, CreateProductInput } from './product.model.ts';
import { products } from '../../db/schema.ts';
import { eq, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

export class ProductService {
    private static db: any;

    static setDb(db: any) {
        this.db = db;
    }

    static async findAll(): Promise<Product[]> {
        return this.db.select().from(products).all();
    }

    static async findById(id: string, tx?: any): Promise<Product | undefined> {
        const executor = tx || this.db;
        return executor.select().from(products).where(eq(products.id, id)).get();
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

    static async checkStock(id: string, quantity: number, tx?: any): Promise<void> {
        const product = await this.findById(id, tx);
        if (!product) {
            throw new Error(`Product ${id} not found`);
        }
        if (product.stock < quantity) {
            throw new Error(`Insufficient stock for product ${product.name}`);
        }
    }

    static async decreaseStock(id: string, quantity: number, tx?: any): Promise<void> {
        await this.checkStock(id, quantity, tx);
        const executor = tx || this.db;
        executor.update(products)
            .set({
                stock: sql`${products.stock} - ${quantity}`,
                updatedAt: new Date()
            })
            .where(eq(products.id, id))
            .run();
    }
}
