import type { DbDriver } from '@iskra-bun/db-kit';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { users } from '../db/schema';
import { sql } from 'drizzle-orm';

type Schema = { users: typeof users };

export class UserService {
    constructor(private db: DbDriver<Schema>) {}

    /**
     * The driver's `db` handle is a union across all supported dialects and is
     * undefined until the driver starts. This template targets SQLite, so narrow
     * to the SQLite member after guarding against the not-yet-started case.
     */
    private get sqlite(): BunSQLiteDatabase<Schema> {
        if (!this.db.db) {
            throw new Error('DB driver is not started yet');
        }
        return this.db.db as unknown as BunSQLiteDatabase<Schema>;
    }

    async initTable() {
        await this.sqlite.run(sql`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                created_at INTEGER
            )
        `);
    }

    async findAll() {
        return this.sqlite.select().from(users);
    }

    async create(name: string, email: string) {
        await this.sqlite.insert(users).values({ name, email });
        return { name, email };
    }
}
