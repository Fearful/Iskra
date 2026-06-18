import type { Feature, DbConfig } from "../types";
import type { Kernel } from "../kernel";
import type { Context, Next } from "hono";
import { drizzle } from 'drizzle-orm/postgres-js';
import { drizzle as drizzleMysql } from 'drizzle-orm/mysql2';
import { drizzle as drizzleBunSqlite } from 'drizzle-orm/bun-sqlite';
import postgres from 'postgres';
import mysql from 'mysql2/promise';
import { Database } from 'bun:sqlite';

declare module "hono" {
    interface ContextVariableMap {
        db: any;
    }
}

export class DbFeature implements Feature {
    name = "db";
    private client: any;
    public db: any;
    public readonly adapter: string;

    constructor(private config: DbConfig) {
        this.adapter = config.adapter;
    }

    async initialize(kernel: Kernel): Promise<void> {
        const config = this.config;
        console.log(`⚙️ Initializing DB driver: ${config.adapter}`);

        try {
            switch (config.adapter) {
                case 'postgres': {
                    if (!config.connection) throw new Error("Missing connection info");
                    const pgConfig = config.connection.connectionString ? config.connection.connectionString : {
                        host: config.connection.host || 'localhost',
                        port: config.connection.port || 5432,
                        database: config.connection.database!,
                        user: config.connection.user!,
                        password: config.connection.password!
                    };
                    this.client = postgres(pgConfig as any);
                    this.db = drizzle(this.client);
                    break;
                }
                case 'mysql': {
                    if (!config.connection) throw new Error("Missing connection info");
                    const mysqlConfig = config.connection.connectionString ? config.connection.connectionString : {
                        host: config.connection.host || 'localhost',
                        port: config.connection.port || 3306,
                        database: config.connection.database!,
                        user: config.connection.user!,
                        password: config.connection.password!
                    };
                    this.client = await mysql.createConnection(mysqlConfig as any);
                    this.db = drizzleMysql(this.client);
                    break;
                }
                case 'sqlite': {
                    const url = config.connection?.database || ':memory:';
                    this.client = new Database(url);
                    this.db = drizzleBunSqlite(this.client);
                    break;
                }
                default:
                    throw new Error(`Unsupported DB adapter: ${config.adapter}`);
            }
            console.log('✅ DB connected successfully.');
        } catch (error) {
            console.error('❌ Failed to connect to DB', error);
            throw error;
        }

        const app = kernel.getApp();
        app.use("*", async (c: Context, next: Next) => {
            c.set("db", this.db);
            await next();
        });
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
