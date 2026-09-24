import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';

/** The template's database: SQLite through bun:sqlite (DbDriver's `sqlite` driver). */
export type Db = BunSQLiteDatabase;
/** A transaction handle: the same query API as Db, inside `db.transaction()`. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
