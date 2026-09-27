import { spaces } from '@forms-app/shared/db';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import type { Space, CreateSpaceInput, UpdateSpaceInput } from '@forms-app/shared';
import type { FormsDb } from '@forms-app/shared/db/client';

export class SpaceService {
    private static db: FormsDb;

    static setDb(db: FormsDb) {
        this.db = db;
    }

    static async findAll(): Promise<Space[]> {
        return this.db.select().from(spaces);
    }

    static async findById(id: string): Promise<Space | undefined> {
        const results = await this.db.select().from(spaces).where(eq(spaces.id, id));
        return results[0];
    }

    static async findBySlug(slug: string): Promise<Space | undefined> {
        const results = await this.db.select().from(spaces).where(eq(spaces.slug, slug));
        return results[0];
    }

    static async create(input: CreateSpaceInput): Promise<Space> {
        const space: Space = {
            id: uuidv4(),
            name: input.name,
            slug: input.slug,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        await this.db.insert(spaces).values(space);
        return space;
    }

    static async update(id: string, input: UpdateSpaceInput): Promise<Space | undefined> {
        await this.db
            .update(spaces)
            .set({ ...input, updatedAt: new Date() })
            .where(eq(spaces.id, id));
        return this.findById(id);
    }

    static async delete(id: string): Promise<void> {
        await this.db.delete(spaces).where(eq(spaces.id, id));
    }
}
