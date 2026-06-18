import { type App, type Driver, type AppConfig, DriverError } from '@iskra-bun/core';
import { drizzle } from 'drizzle-orm/postgres-js';
import { drizzle as drizzleMysql } from 'drizzle-orm/mysql2';
import postgres from 'postgres';
import mysql from 'mysql2/promise';
import { ConnectionError } from './errors';
import { MigrationHelper, mapDialect } from './migrations';

export class DbDriver implements Driver {
    name = 'db';
    private client: any;
    public db: any;

    private app: App | undefined;

    async init(app: App) {
        this.app = app;
        app.context.set('db', this);
    }

    async start() {
        if (!this.app) return;
        const config = this.app.config.db;
        if (!config) {
            this.app!.logger.warn('No DB configuration found. Skipping DB initialization.');
            return;
        }

        this.app!.logger.info(`Initializing DB driver: ${config.driver}`);

        try {
            switch (config.driver) {
                case 'postgres':
                    this.client = postgres(config.url);
                    this.db = drizzle(this.client);
                    break;
                case 'mysql':
                    this.client = await mysql.createConnection(config.url);
                    this.db = drizzleMysql(this.client);
                    break;
                case 'sqlite': {
                    const { Database } = await import("bun:sqlite");
                    const { drizzle: drizzleSqlite } = await import("drizzle-orm/bun-sqlite");
                    this.client = new Database(config.url);
                    this.db = drizzleSqlite(this.client);
                    break;
                }
                case 'libsql': {
                    const { createClient } = await import('@libsql/client');
                    const { drizzle: drizzleLibsql } = await import('drizzle-orm/libsql');
                    this.client = createClient({ url: config.url, authToken: config.authToken });
                    this.db = drizzleLibsql(this.client);
                    break;
                }
                default:
                    throw new DriverError(`Unsupported DB driver: ${config.driver}`, {
                        code: 'DRIVER_START_FAILED',
                        context: { driver: config.driver },
                    });
            }
            this.app!.logger.info('DB connected successfully.');
        } catch (error) {
            if (error instanceof DriverError) throw error;
            this.app!.logger.error({ error }, 'Failed to connect to DB');
            throw new ConnectionError('Failed to connect to DB', {
                cause: error instanceof Error ? error : new Error(String(error)),
                context: { driver: config.driver, url: config.url },
            });
        }
    }

    /**
     * Ejecuta migraciones pendientes usando Drizzle Kit.
     */
    async runMigrations(schemaPath: string, migrationsDir: string = './drizzle'): Promise<void> {
        if (!this.app?.config.db) {
            throw new DriverError('Cannot run migrations: no DB configuration found', {
                code: 'DRIVER_START_FAILED',
            });
        }

        const config = this.app.config.db;
        const helper = new MigrationHelper(
            {
                dialect: mapDialect(config.driver),
                dbUrl: config.url,
                schemaPath,
                migrationsDir,
            },
            this.app,
        );

        await helper.migrate();
    }

    async stop() {
        if (this.client) {
            // Close connections based on client type
            if (this.client.end) { // Postgres usage with postgres.js usually handles itself or has end. 
                // mysql2 has end()
                await this.client.end();
            } else if (this.client.close) { // bun:sqlite / libsql
                this.client.close();
            }
            // postgres.js handles cleanup usually but explicit close might be needed depending on version/usage
        }
    }
}
