import { type App, type Driver, type AppConfig, DriverError } from '@iskra-bun/core';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { drizzle as drizzleMysql, type MySql2Database } from 'drizzle-orm/mysql2';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import postgres from 'postgres';
import mysql from 'mysql2/promise';
import { sql } from 'drizzle-orm';
import { ConnectionError, MigrationError, QueryError } from './errors';

/**
 * Observability callback invoked for every SQL statement Drizzle executes.
 * Receives the rendered query and its bound parameters.
 */
export type OnQueryHook = (query: string, params: unknown[]) => void;

/**
 * The transaction handle passed to {@link DbDriver.transaction}. Drizzle types
 * the transaction object per dialect, so — like {@link IskraDrizzleDb} — this is
 * the union of the supported dialect databases for the same schema. Callers can
 * narrow by dialect if they need dialect-specific transaction APIs.
 */
export type IskraDrizzleTx<TSchema extends Record<string, unknown> = Record<string, never>> =
    IskraDrizzleDb<TSchema>;

/**
 * The Drizzle database handle exposed by {@link DbDriver}, parameterized by the
 * caller's schema. Because the concrete dialect is chosen at runtime, this is a
 * union of the supported dialect databases — all four share the same
 * `TSchema extends Record<string, unknown> = Record<string, never>` parameter,
 * so passing a schema types `db.query.*` for opt-in callers while the default
 * `Record<string, never>` reproduces the historical untyped behavior.
 */
export type IskraDrizzleDb<TSchema extends Record<string, unknown> = Record<string, never>> =
    | PostgresJsDatabase<TSchema>
    | MySql2Database<TSchema>
    | BunSQLiteDatabase<TSchema>
    | LibSQLDatabase<TSchema>;

/**
 * Redact username and password from a database URL so it is safe to log.
 * Returns the scrubbed URL string, or undefined if parsing fails.
 *
 * e.g. postgres://user:pass@host:5432/db → postgres://***:***@host:5432/db
 */
export function scrubUrl(url: string): string | undefined {
    try {
        const parsed = new URL(url);
        if (parsed.username) parsed.username = '***';
        if (parsed.password) parsed.password = '***';
        return parsed.toString();
    } catch {
        return undefined;
    }
}

/**
 * The minimal teardown surface {@link DbDriver.stop} probes on the underlying
 * client. postgres-js and mysql2 expose async `end()`; bun:sqlite and libsql
 * expose synchronous `close()`. Typed as optional so either shape satisfies it.
 */
interface DbClient {
    end?(): Promise<void>;
    close?(): void;
}

export class DbDriver<TSchema extends Record<string, unknown> = Record<string, never>> implements Driver {
    name = 'db';
    private client: DbClient | undefined;
    public db: IskraDrizzleDb<TSchema> | undefined;

    private app: App | undefined;
    private onQuery: OnQueryHook | undefined;

    /**
     * Register an observability callback that receives every SQL statement (and
     * its bound params) Drizzle executes. Must be called before {@link start},
     * since Drizzle's logger is wired at connection time. A throwing callback is
     * swallowed so observability never breaks a real query.
     */
    setOnQuery(onQuery: OnQueryHook): void {
        this.onQuery = onQuery;
    }

    /**
     * Build the Drizzle `logger` option that forwards to {@link onQuery} when a
     * hook is registered, or `undefined` to leave Drizzle's default logging off.
     */
    private buildLogger(): { logQuery(query: string, params: unknown[]): void } | undefined {
        const hook = this.onQuery;
        if (!hook) return undefined;
        return {
            logQuery: (query: string, params: unknown[]) => {
                try {
                    hook(query, params);
                } catch {
                    // Observability must never break the underlying query.
                }
            },
        };
    }

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

        const logger = this.buildLogger();

        try {
            switch (config.driver) {
                case 'postgres': {
                    const client = postgres(config.url);
                    this.client = client;
                    this.db = drizzle<TSchema>(client, { logger });
                    break;
                }
                case 'mysql': {
                    const client = mysql.createPool(config.url);
                    this.client = client;
                    // Name the client type: with only TSchema given, drizzle's
                    // TClient defaults to mysql2's callback Pool, not this promise Pool.
                    this.db = drizzleMysql<TSchema, typeof client>(client, { logger });
                    break;
                }
                case 'sqlite': {
                    const { Database } = await import("bun:sqlite");
                    const { drizzle: drizzleSqlite } = await import("drizzle-orm/bun-sqlite");
                    const client = new Database(config.url);
                    this.client = client;
                    this.db = drizzleSqlite<TSchema>(client, { logger });
                    break;
                }
                case 'libsql': {
                    const { createClient } = await import('@libsql/client');
                    const { drizzle: drizzleLibsql } = await import('drizzle-orm/libsql');
                    const client = createClient({ url: config.url, authToken: config.authToken });
                    this.client = client;
                    this.db = drizzleLibsql<TSchema>(client, { logger });
                    break;
                }
                default:
                    throw new DriverError(`Unsupported DB driver: ${config.driver}`, {
                        code: 'DRIVER_START_FAILED',
                        context: { driver: config.driver },
                    });
            }
            // postgres-js and mysql2 pools connect lazily: without a round-trip
            // a wrong host or password only surfaced on the first query.
            await this.roundTrip();
            this.app!.logger.info('DB connected successfully.');
        } catch (error) {
            if (error instanceof DriverError) throw error;
            await this.stop();
            this.app!.logger.error({ error }, 'Failed to connect to DB');
            const safeUrl = scrubUrl(config.url);
            throw new ConnectionError('Failed to connect to DB', {
                cause: error instanceof Error ? error : new Error(String(error)),
                context: {
                    driver: config.driver,
                    ...(safeUrl !== undefined ? { url: safeUrl } : {}),
                },
            });
        }
    }

    /**
     * Applies the pending migrations in `migrationsDir` (generated with
     * `drizzle-kit generate`) over the live connection, using Drizzle's
     * migrator for the configured dialect. Requires `start()`.
     *
     * It used to shell out to `drizzle-kit migrate`, which ignored both
     * arguments and failed without a drizzle.config.ts. `schemaPath` is kept for
     * compatibility; applying migrations does not need the schema.
     */
    async runMigrations(_schemaPath?: string, migrationsDir: string = './drizzle'): Promise<void> {
        const config = this.app?.config.db;
        if (!config) {
            throw new DriverError('Cannot run migrations: no DB configuration found', {
                code: 'DRIVER_START_FAILED',
            });
        }
        if (!this.db) {
            throw new DriverError('Cannot run migrations: DB is not started', {
                code: 'DRIVER_START_FAILED',
                context: { driver: config.driver },
            });
        }

        const options = { migrationsFolder: migrationsDir };
        const db = this.db as never;
        try {
            switch (config.driver) {
                case 'postgres':
                    await (await import('drizzle-orm/postgres-js/migrator')).migrate(db, options);
                    break;
                case 'mysql':
                    await (await import('drizzle-orm/mysql2/migrator')).migrate(db, options);
                    break;
                case 'sqlite':
                    (await import('drizzle-orm/bun-sqlite/migrator')).migrate(db, options);
                    break;
                case 'libsql':
                    await (await import('drizzle-orm/libsql/migrator')).migrate(db, options);
                    break;
            }
            this.app!.logger.info({ migrationsDir }, 'Migrations applied');
        } catch (error) {
            throw new MigrationError('Failed to apply migrations', {
                cause: error instanceof Error ? error : new Error(String(error)),
                context: { driver: config.driver, migrationsDir },
            });
        }
    }

    /**
     * Run `fn` inside a database transaction, delegating to Drizzle's
     * `db.transaction`. Callers receive the transaction-scoped db handle instead
     * of reaching into the raw `db`. The dialect union means `tx` is typed as
     * {@link IskraDrizzleTx}; narrow by dialect if you need dialect-specific APIs.
     * Failures are wrapped in {@link QueryError} (Drizzle rolls back on throw).
     */
    async transaction<R>(fn: (tx: IskraDrizzleTx<TSchema>) => Promise<R>): Promise<R> {
        if (!this.db) {
            throw new QueryError('Cannot run transaction: DB is not started', {
                context: { driver: this.app?.config.db?.driver },
            });
        }
        try {
            // The dialect-specific `transaction` overloads do not unify across the
            // union, so we route through the runtime method with a faithful cast
            // of the public handle types.
            return await (this.db as IskraDrizzleDb<TSchema> & {
                transaction(cb: (tx: IskraDrizzleTx<TSchema>) => Promise<R>): Promise<R>;
            }).transaction((tx) => fn(tx));
        } catch (error) {
            if (error instanceof QueryError) throw error;
            throw new QueryError('Transaction failed', {
                cause: error instanceof Error ? error : new Error(String(error)),
                context: { driver: this.app?.config.db?.driver },
            });
        }
    }

    /**
     * Liveness probe for readiness checks (e.g. web-kit's addReadinessCheck /
     * k8s readiness). Runs a trivial `SELECT 1` against the active dialect and
     * resolves `true` on success or `false` on any failure — it never rejects.
     */
    async ping(): Promise<boolean> {
        if (!this.db) return false;
        try {
            await this.roundTrip();
            return true;
        } catch {
            return false;
        }
    }

    /** `SELECT 1` on the active connection; throws on failure. */
    private async roundTrip(): Promise<void> {
        // bun-sqlite exposes the synchronous `.run()`; postgres-js, mysql2 and
        // libsql expose the async `.execute()`. Prefer whichever exists.
        const handle = this.db as {
            run?(query: unknown): unknown;
            execute?(query: unknown): Promise<unknown>;
        };
        if (typeof handle.run === 'function') {
            await handle.run(sql`SELECT 1`);
        } else if (typeof handle.execute === 'function') {
            await handle.execute(sql`SELECT 1`);
        } else {
            throw new Error('DB handle exposes neither run() nor execute()');
        }
    }

    async stop() {
        const client = this.client;
        try {
            // postgres-js / mysql2 expose async end(); bun:sqlite / libsql expose
            // synchronous close(). Probe for whichever this client provides.
            if (client?.end) {
                await client.end();
            } else if (client?.close) {
                client.close();
            }
        } catch (error) {
            // A throwing teardown must never abort the orderly shutdown of other
            // drivers; log and continue so the handles below are still cleared.
            this.app?.logger.error({ error }, 'Failed to close DB connection cleanly');
        } finally {
            // Null the handles so a post-stop ping()/transaction() hits the
            // not-started guard instead of an already-closed connection.
            this.client = undefined;
            this.db = undefined;
        }
    }
}
