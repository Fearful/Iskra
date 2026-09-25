import type { Feature, DbConfig } from '../types';
import type { Kernel } from '../kernel';
import type { Context, Next } from 'hono';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { drizzle as drizzleMysql, type MySql2Database } from 'drizzle-orm/mysql2';
import { drizzle as drizzleBunSqlite, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import postgres from 'postgres';
import mysql from 'mysql2/promise';
import { Database } from 'bun:sqlite';
import { consoleLogger, type KernelLogger } from '../logging';

/**
 * The Drizzle database handle a {@link DbFeature} exposes, parameterized by the
 * caller's schema. A union of the supported dialect databases — all share the
 * same `TSchema extends Record<string, unknown> = Record<string, never>`
 * parameter, so passing a schema types `db.query.*` for opt-in callers while the
 * default `Record<string, never>` reproduces the historical untyped behavior.
 */
export type WebKitDrizzleDb<TSchema extends Record<string, unknown> = Record<string, never>> =
    | PostgresJsDatabase<TSchema>
    | MySql2Database<TSchema>
    | BunSQLiteDatabase<TSchema>;

declare module 'hono' {
    interface ContextVariableMap {
        db: WebKitDrizzleDb;
    }
}

export class DbFeature<TSchema extends Record<string, unknown> = Record<string, never>> implements Feature {
    name = 'db';
    private log: KernelLogger = consoleLogger;
    /** The driver's own client, by dialect (ping and shutdown use it). */
    private client?:
        | { dialect: 'postgres'; sql: postgres.Sql }
        | { dialect: 'mysql'; pool: mysql.Pool }
        | { dialect: 'sqlite'; database: Database };
    public db!: WebKitDrizzleDb<TSchema>;
    public readonly adapter: DbConfig['adapter'];

    constructor(private config: DbConfig) {
        this.adapter = config.adapter;
    }

    async initialize(kernel: Kernel): Promise<void> {
        this.log = kernel.getLogger();
        const config = this.config;
        this.log.debug(`Initializing DB driver: ${config.adapter}`);

        try {
            switch (config.adapter) {
                case 'postgres': {
                    if (!config.connection) throw new Error('Missing connection info');
                    const conn = config.connection;
                    const sql = conn.connectionString
                        ? postgres(conn.connectionString)
                        : postgres({
                              host: conn.host || 'localhost',
                              port: conn.port || 5432,
                              database: conn.database,
                              user: conn.user,
                              password: conn.password,
                          });
                    this.client = { dialect: 'postgres', sql };
                    this.db = drizzle<TSchema>(sql);
                    break;
                }
                case 'mysql': {
                    if (!config.connection) throw new Error('Missing connection info');
                    const conn = config.connection;
                    // A pool, not a single connection: one dropped connection must
                    // not take the app's database access down with it.
                    const pool = conn.connectionString
                        ? mysql.createPool(conn.connectionString)
                        : mysql.createPool({
                              host: conn.host || 'localhost',
                              port: conn.port || 3306,
                              database: conn.database,
                              user: conn.user,
                              password: conn.password,
                          });
                    this.client = { dialect: 'mysql', pool };
                    // Name the client type, as db-kit does: with only TSchema, drizzle infers another Pool.
                    this.db = drizzleMysql<TSchema, typeof pool>(pool);
                    break;
                }
                case 'sqlite': {
                    const url = config.connection?.database || ':memory:';
                    const database = new Database(url);
                    this.client = { dialect: 'sqlite', database };
                    this.db = drizzleBunSqlite<TSchema>(database);
                    break;
                }
                default:
                    throw new Error(`Unsupported DB adapter: ${config.adapter}`);
            }
            this.log.debug('DB connected');
        } catch (error) {
            // Log only the message — the full error/config object can embed the
            // connection string (host, user, password) and must not be logged.
            const message = error instanceof Error ? error.message : String(error);
            this.log.error(`Failed to connect to DB: ${message}`);
            throw error;
        }

        const app = kernel.getApp();
        app.use('*', async (c: Context, next: Next) => {
            c.set('db', this.db as WebKitDrizzleDb);
            await next();
        });
    }

    /** One round-trip to the database (used by HealthCheckFeature). */
    async ping(): Promise<void> {
        const client = this.client;
        if (!client) throw new Error('DB not initialized');
        switch (client.dialect) {
            case 'postgres':
                await client.sql`select 1`;
                break;
            case 'mysql':
                await client.pool.query('select 1');
                break;
            case 'sqlite':
                client.database.query('select 1').get();
                break;
        }
    }

    async shutdown(): Promise<void> {
        const client = this.client;
        this.client = undefined;
        if (client?.dialect === 'postgres') await client.sql.end();
        else if (client?.dialect === 'mysql') await client.pool.end();
        else client?.database.close();
    }
}
