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
    private client: any;
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
                    const pgConfig = config.connection.connectionString
                        ? config.connection.connectionString
                        : {
                              host: config.connection.host || 'localhost',
                              port: config.connection.port || 5432,
                              database: config.connection.database!,
                              user: config.connection.user!,
                              password: config.connection.password!,
                          };
                    this.client = postgres(pgConfig as any);
                    this.db = drizzle<TSchema>(this.client);
                    break;
                }
                case 'mysql': {
                    if (!config.connection) throw new Error('Missing connection info');
                    const mysqlConfig = config.connection.connectionString
                        ? config.connection.connectionString
                        : {
                              host: config.connection.host || 'localhost',
                              port: config.connection.port || 3306,
                              database: config.connection.database!,
                              user: config.connection.user!,
                              password: config.connection.password!,
                          };
                    // A pool, not a single connection: one dropped connection must
                    // not take the app's database access down with it.
                    this.client = mysql.createPool(mysqlConfig as any);
                    this.db = drizzleMysql<TSchema>(this.client);
                    break;
                }
                case 'sqlite': {
                    const url = config.connection?.database || ':memory:';
                    this.client = new Database(url);
                    this.db = drizzleBunSqlite<TSchema>(this.client);
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
        switch (this.config.adapter) {
            case 'postgres':
                await this.client`select 1`;
                break;
            case 'mysql':
                await this.client.query('select 1');
                break;
            case 'sqlite':
                this.client.query('select 1').get();
                break;
        }
    }

    async shutdown(): Promise<void> {
        if (this.client) {
            if (this.client.end) {
                await this.client.end();
            } else if (this.client.close) {
                this.client.close();
            }
        }
    }
}
