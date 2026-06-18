import type { DbDriver } from '@iskra-bun/db-kit';
import { users } from '../db/schema';
import { sql } from 'drizzle-orm';

export class UserService {
    constructor(private db: DbDriver) {}

    async initTable() {
        await this.db.db.run(sql`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                created_at INTEGER
            )
        `);
    }

    async findAll() {
        return this.db.db.select().from(users);
    }

    async create(name: string, email: string) {
        await this.db.db.insert(users).values({ name, email });
        return { name, email };
    }
}
