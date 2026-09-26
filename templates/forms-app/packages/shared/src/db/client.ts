import { is } from 'drizzle-orm';
import { PgDatabase, type PgQueryResultHKT } from 'drizzle-orm/pg-core';

/**
 * The Drizzle database the forms-app services query. The schema is Postgres
 * (pgTable), so it is a Postgres database, whichever Postgres driver made it.
 */
export type FormsDb = PgDatabase<PgQueryResultHKT, Record<string, unknown>>;

/**
 * DbDriver's `db` as a {@link FormsDb}. DbDriver types it as the union of
 * every dialect it supports; the forms-app tables only exist in Postgres.
 */
export function asFormsDb(db: unknown): FormsDb {
    if (!is(db, PgDatabase)) throw new Error('forms-app needs a Postgres database (the "postgres" db driver)');
    return db;
}

/**
 * The ioredis commands the forms-app services use (KVManager's client). Only
 * these, so a test can pass an object with just the ones it needs.
 */
export interface FormsRedis {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<unknown>;
    del(...keys: string[]): Promise<unknown>;
    sadd(key: string, ...members: string[]): Promise<unknown>;
    srem(key: string, ...members: string[]): Promise<unknown>;
    expire(key: string, seconds: number): Promise<unknown>;
}
