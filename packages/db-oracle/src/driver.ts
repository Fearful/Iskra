import type { App, Driver } from '@iskra-bun/core';
import { CamelCasePlugin, Kysely, type KyselyPlugin, type SelectQueryBuilder } from 'kysely';
import type * as OracleDB from 'oracledb';
import { fetchTypeHandler, readOutBinds, toOracleBinds, type OracleBinds, type OutBinds } from './binds';
import { resolveConfig, type ResolvedOracleConfig } from './config';
import { OracleDialect, type StatementRunner } from './dialect';
import { ConnectionError, MigrationError, QueryError, toQueryError } from './errors';
import { runMigrations, type MigrationOptions } from './migrations';
import { paginate, type Page, type PageOptions } from './pagination';
import type {
    ConnectionHandle,
    OracleConnectionLike,
    OraclePoolLike,
    OracleRawResult,
    OracleResultSetLike,
} from './types';

type OracledbModule = typeof OracleDB;

/** Called with every statement the driver runs (raw and Kysely) and its binds. */
export type OnQueryHook = (sql: string, binds: unknown) => void;

export interface ExecuteResult<T, O> {
    /** Rows of a query, as objects keyed by column name (Oracle's upper case). */
    rows: T[];
    /** Rows an INSERT, UPDATE, DELETE or MERGE changed; 0 for other statements. */
    rowsAffected: number;
    /** OUT, IN OUT and RETURNING INTO values by bind name. */
    outBinds: O;
}

/** What `transaction()` hands its callback: everything runs on its one connection. */
export interface OracleTransaction<DB> {
    db: Kysely<DB>;
    query<T = Record<string, unknown>>(sql: string, binds?: OracleBinds): Promise<T[]>;
    execute<T = Record<string, unknown>, const B extends OracleBinds = OracleBinds>(
        sql: string,
        binds?: B,
    ): Promise<ExecuteResult<T, OutBinds<B>>>;
    executeMany(sql: string, rows: readonly OracleBinds[]): Promise<{ rowsAffected: number }>;
}

async function loadOracledb(): Promise<OracledbModule> {
    const mod = (await import('oracledb')) as OracledbModule & { default?: OracledbModule };
    return mod.default ?? mod;
}

/**
 * Oracle Database for Iskra: a node-oracledb pool (Thin mode, no Oracle
 * Client) in the app's process, typed queries with Kysely (`db`), raw SQL
 * with typed binds (`query`, `execute`), transactions, pagination and
 * migrations. Configured by `app.config.oracle`, or ORA_CONN, ORA_USER and
 * ORA_PASSWORD; without either it does not start.
 */
export class OracleDriver<DB = Record<string, never>> implements Driver {
    name = 'OracleDriver';
    /** Kysely over the pool, typed by `DB`; set by start(). */
    public db: Kysely<DB> | undefined;

    private app: App | undefined;
    private oracledb: OracledbModule | undefined;
    private config: ResolvedOracleConfig | undefined;
    private pool: OraclePoolLike | undefined;
    private fetchHandler: ReturnType<typeof fetchTypeHandler> | undefined;
    private onQuery: OnQueryHook | undefined;

    private readonly runner: StatementRunner = {
        run: (handle, sql, binds) => this.run(handle, sql, binds),
        streamRows: (handle, sql, binds, chunkSize) => this.streamRows(handle, sql, binds, chunkSize),
    };

    async init(app: App) {
        this.app = app;
        app.context.set('oracle', this);
    }

    async start() {
        if (!this.app || this.pool) return;
        const config = resolveConfig(this.app.config.oracle);
        if (!config) {
            this.app.logger.warn(
                'Oracle is not configured (app.config.oracle or ORA_CONN): OracleDriver will not start.',
            );
            return;
        }
        const { connectString, user } = config;
        this.app.logger.info({ connectString }, 'Initializing Oracle driver');
        try {
            this.oracledb = await loadOracledb();
            this.config = config;
            this.fetchHandler = fetchTypeHandler(this.oracledb, config.fetchAsString);
            this.pool = await this.createPool({
                ...config.poolAttributes,
                connectString,
                user,
                password: config.password,
                poolMin: config.pool.min,
                poolMax: config.pool.max,
                poolIncrement: config.pool.increment,
                queueTimeout: config.pool.queueTimeout,
            });
            // The pool connects lazily: a wrong password or host fails start()
            // here instead of the first query.
            await this.withConnection((handle) => this.run(handle, 'SELECT 1 FROM DUAL', []));
            this.db = this.createKysely(() => this.acquire());
            this.app.logger.info('Oracle connected successfully.');
        } catch (error) {
            await this.stop();
            const cause = error instanceof QueryError && error.cause instanceof Error ? error.cause : error;
            const reason = cause instanceof Error ? cause.message.split('\n')[0] : String(cause);
            throw new ConnectionError(`Failed to connect to Oracle: ${reason}`, {
                cause: cause instanceof Error ? cause : undefined,
                context: { connectString, ...(user ? { user } : {}) },
            });
        }
    }

    async stop() {
        const pool = this.pool;
        this.pool = undefined;
        this.db = undefined;
        if (!pool) return;
        try {
            // Connections in use get drainTime seconds to be released.
            await pool.close(this.config?.pool.drainTime ?? 5);
        } catch (error) {
            this.app?.logger.error({ error }, 'Failed to close the Oracle pool cleanly');
        }
    }

    /**
     * Register a callback for every statement and its binds (raw and Kysely).
     * A throwing callback is ignored: observability never fails a query.
     */
    setOnQuery(onQuery: OnQueryHook | undefined): void {
        this.onQuery = onQuery;
    }

    /** `SELECT 1 FROM DUAL` for readiness checks: true or false, never throws. */
    async ping(): Promise<boolean> {
        if (!this.pool) return false;
        try {
            await this.withConnection((handle) => this.run(handle, 'SELECT 1 FROM DUAL', []));
            return true;
        } catch {
            return false;
        }
    }

    /** The rows of a query. */
    async query<T = Record<string, unknown>>(sql: string, binds?: OracleBinds): Promise<T[]> {
        return this.withConnection(async (handle) => (await this.executeOn<T, OracleBinds>(handle, sql, binds)).rows);
    }

    /**
     * Runs a statement: rows, rowsAffected and outBinds. Binds by name may
     * give a type by name: `{ id: { dir: 'returning', type: 'number' } }` for
     * `RETURNING id INTO :id`, `{ dir: 'out', type: 'string' }` for a PL/SQL
     * OUT parameter, `{ type: 'clob', val: text }` for a long IN value.
     * Outside a transaction it commits on its own.
     */
    async execute<T = Record<string, unknown>, const B extends OracleBinds = OracleBinds>(
        sql: string,
        binds?: B,
    ): Promise<ExecuteResult<T, OutBinds<B>>> {
        return this.withConnection((handle) => this.executeOn<T, B>(handle, sql, binds));
    }

    /** Runs a DML statement once per row of binds (a bulk insert), in one round trip. */
    async executeMany(sql: string, rows: readonly OracleBinds[]): Promise<{ rowsAffected: number }> {
        return this.withConnection((handle) => this.executeManyOn(handle, sql, rows));
    }

    /** The rows of a query one at a time, fetched `chunkSize` (default 100) at a time. */
    async *stream<T = Record<string, unknown>>(
        sql: string,
        binds?: OracleBinds,
        options: { chunkSize?: number } = {},
    ): AsyncGenerator<T> {
        const handle = await this.acquire();
        try {
            for await (const rows of this.streamRows(handle, sql, binds, options.chunkSize ?? 100)) {
                for (const row of rows) yield row as T;
            }
        } finally {
            await handle.release();
        }
    }

    /**
     * Runs `fn` on one connection with autoCommit off, and commits when it
     * returns or rolls back when it throws (rethrowing its error). `tx.db` is
     * Kysely on that connection; `oracle.db.transaction()` works too.
     */
    async transaction<R>(fn: (tx: OracleTransaction<DB>) => Promise<R>): Promise<R> {
        const handle = await this.acquire();
        const pinned: ConnectionHandle = {
            connection: handle.connection,
            inTransaction: true,
            release: async () => {},
        };
        try {
            const result = await fn({
                db: this.createKysely(async () => pinned),
                query: async <T>(sql: string, binds?: OracleBinds) =>
                    (await this.executeOn<T, OracleBinds>(pinned, sql, binds)).rows,
                execute: <T, const B extends OracleBinds>(sql: string, binds?: B) =>
                    this.executeOn<T, B>(pinned, sql, binds),
                executeMany: (sql, rows) => this.executeManyOn(pinned, sql, rows),
            });
            try {
                await handle.connection.commit();
            } catch (error) {
                throw toQueryError(error, 'Failed to commit the transaction');
            }
            return result;
        } catch (error) {
            try {
                await handle.connection.rollback();
            } catch (rollbackError) {
                this.app?.logger.error({ error: rollbackError }, 'Failed to roll back an Oracle transaction');
            }
            throw error;
        } finally {
            await handle.release();
        }
    }

    /** One page of a Kysely query and its total: see `paginate()`. */
    async paginate<TB extends keyof DB, O>(
        query: SelectQueryBuilder<DB, TB, O>,
        options?: PageOptions,
    ): Promise<Page<O>> {
        return paginate(this.started().db, query, options);
    }

    /**
     * Applies the pending `.sql` migrations of `dir` (default `./migrations`)
     * and returns their names. Needs start().
     */
    async runMigrations(dir = './migrations', options?: MigrationOptions): Promise<string[]> {
        if (!this.pool || !this.config) {
            throw new MigrationError('Cannot run migrations: the Oracle driver is not started');
        }
        const { connectString, user, password, poolAttributes } = this.config;
        return runMigrations(
            {
                connect: () => this.connect({ ...poolAttributes, connectString, user, password }),
                run: (handle, sql, binds) => this.run(handle, sql, binds),
                log: (message, context) => this.app?.logger.info(context, message),
            },
            dir,
            options,
        );
    }

    /** Creates the pool; tests replace it with a fake one. */
    protected async createPool(attributes: Record<string, unknown>): Promise<OraclePoolLike> {
        const oracledb = await loadOracledb();
        return (await oracledb.createPool(attributes as OracleDB.PoolAttributes)) as unknown as OraclePoolLike;
    }

    /** Opens a standalone connection (for the migrations lock); tests replace it. */
    protected async connect(attributes: Record<string, unknown>): Promise<OracleConnectionLike> {
        const oracledb = await loadOracledb();
        return (await oracledb.getConnection(
            attributes as OracleDB.ConnectionAttributes,
        )) as unknown as OracleConnectionLike;
    }

    private started() {
        const { oracledb, config, pool, db } = this;
        if (!oracledb || !config || !pool || !db) throw new QueryError('Oracle driver not started');
        return { oracledb, config, pool, db };
    }

    private createKysely(acquire: () => Promise<ConnectionHandle>): Kysely<DB> {
        const plugins: KyselyPlugin[] = this.config?.camelCase ? [new CamelCasePlugin({ upperCase: true })] : [];
        return new Kysely<DB>({ dialect: new OracleDialect({ acquire, runner: this.runner }), plugins });
    }

    private async acquire(): Promise<ConnectionHandle> {
        const pool = this.pool;
        if (!pool) throw new QueryError('Oracle driver not started');
        let connection: OracleConnectionLike;
        try {
            connection = await pool.getConnection();
        } catch (error) {
            throw toQueryError(error);
        }
        return {
            connection,
            inTransaction: false,
            release: async () => {
                try {
                    await connection.close();
                } catch (error) {
                    this.app?.logger.warn({ error }, 'Failed to release an Oracle connection');
                }
            },
        };
    }

    private async withConnection<R>(fn: (handle: ConnectionHandle) => Promise<R>): Promise<R> {
        const handle = await this.acquire();
        try {
            return await fn(handle);
        } finally {
            await handle.release();
        }
    }

    private notify(sql: string, binds: unknown) {
        if (!this.onQuery) return;
        try {
            this.onQuery(sql, binds);
        } catch {
            // Observability must never break the query.
        }
    }

    private options(handle: ConnectionHandle): Record<string, unknown> {
        const oracledb = this.oracledb;
        if (!oracledb) throw new QueryError('Oracle driver not started');
        return {
            outFormat: oracledb.OUT_FORMAT_OBJECT,
            autoCommit: !handle.inTransaction,
            fetchTypeHandler: this.fetchHandler,
        };
    }

    private async run(handle: ConnectionHandle, sql: string, binds: unknown): Promise<OracleRawResult> {
        const options = this.options(handle);
        this.notify(sql, binds);
        try {
            return await handle.connection.execute(sql, toOracleBinds(this.oracledb!, binds as OracleBinds), options);
        } catch (error) {
            throw toQueryError(error);
        }
    }

    private async executeOn<T, B>(handle: ConnectionHandle, sql: string, binds: B | undefined) {
        const result = await this.run(handle, sql, binds);
        let outBinds: unknown;
        try {
            outBinds = await readOutBinds(result.outBinds);
        } catch (error) {
            throw toQueryError(error, 'Failed to read a LOB out bind');
        }
        return {
            rows: (result.rows ?? []) as T[],
            rowsAffected: result.rowsAffected ?? 0,
            outBinds: outBinds as OutBinds<B>,
        };
    }

    private async executeManyOn(handle: ConnectionHandle, sql: string, rows: readonly OracleBinds[]) {
        const options = this.options(handle);
        this.notify(sql, rows);
        try {
            const result = await handle.connection.executeMany(sql, [...rows], options);
            return { rowsAffected: result.rowsAffected ?? 0 };
        } catch (error) {
            throw toQueryError(error);
        }
    }

    private async *streamRows(
        handle: ConnectionHandle,
        sql: string,
        binds: unknown,
        chunkSize: number,
    ): AsyncGenerator<unknown[]> {
        const options = { ...this.options(handle), resultSet: true };
        this.notify(sql, binds);
        let resultSet: OracleResultSetLike | undefined;
        try {
            resultSet = (
                await handle.connection.execute(sql, toOracleBinds(this.oracledb!, binds as OracleBinds), options)
            ).resultSet;
        } catch (error) {
            throw toQueryError(error);
        }
        if (!resultSet) throw new QueryError('stream() needs a query that returns rows');
        try {
            for (;;) {
                let rows: unknown[];
                try {
                    rows = await resultSet.getRows(chunkSize);
                } catch (error) {
                    throw toQueryError(error);
                }
                if (rows.length === 0) return;
                yield rows;
            }
        } finally {
            await resultSet.close().catch(() => {});
        }
    }
}

// `app.context.get('oracle')` is the OracleDriver registered on the app.
declare module '@iskra-bun/core' {
    interface AppContextRegistry {
        oracle: OracleDriver;
    }
}
