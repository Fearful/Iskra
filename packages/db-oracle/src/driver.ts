import { AsyncLocalStorage } from 'node:async_hooks';
import type { App, Driver } from '@iskra-bun/core';
import { CamelCasePlugin, Kysely, type KyselyPlugin, type SelectQueryBuilder } from 'kysely';
import type * as OracleDB from 'oracledb';
import {
    fetchTypeHandler,
    readOutBinds,
    toExecuteMany,
    toOracleBinds,
    type OracleBindDef,
    type OracleBinds,
    type OutBinds,
} from './binds';
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

/** How a statement ended, for the function an OnQueryHook may return. */
export interface QueryEnd {
    durationMs: number;
    /** Rows a query returned (a stream: all it yielded). */
    rows?: number;
    /** Rows an INSERT, UPDATE, DELETE or MERGE changed. */
    rowsAffected?: number;
    error?: QueryError;
}

/**
 * Called with every statement the driver runs (raw and Kysely) and its binds.
 * It may return a function, called once the statement ends with its duration,
 * row counts or error: a span's end, for tracing.
 */
export type OnQueryHook = (sql: string, binds: unknown) => unknown;

export interface StatementOptions {
    /** Milliseconds this statement may run, instead of `callTimeout` (0 for no limit). */
    timeout?: number;
    /** Cancels the statement when aborted (a QueryError ORA-01013). */
    signal?: AbortSignal;
    /** Leave out the binds by name that the SQL does not use, instead of `dropUnusedBinds`. */
    dropUnusedBinds?: boolean;
}

export interface ExecuteManyOptions extends Omit<StatementOptions, 'dropUnusedBinds'> {
    /**
     * The type of each bind, by name (or position): `{ body: { type: 'clob' } }`
     * to load CLOBs, `{ id: { dir: 'returning', type: 'number' } }` for
     * `RETURNING id INTO :id`. The binds not named are inferred from the rows.
     */
    bindDefs?: Readonly<Record<string, OracleBindDef>> | readonly OracleBindDef[];
}

export interface ExecuteResult<T, O> {
    /** Rows of a query, as objects keyed by column name (Oracle's upper case). */
    rows: T[];
    /** Rows an INSERT, UPDATE, DELETE or MERGE changed; 0 for other statements. */
    rowsAffected: number;
    /** OUT, IN OUT and RETURNING INTO values by bind name. */
    outBinds: O;
    /** node-oracledb's warning, such as NJS-700 for PL/SQL created with compilation errors. */
    warning?: string;
}

export interface ExecuteManyResult {
    rowsAffected: number;
    /** The out binds of each row, when there are OUT or RETURNING binds. */
    outBinds: unknown[];
}

/** What `transaction()` hands its callback: everything runs on its one connection. */
export interface OracleTransaction<DB> {
    db: Kysely<DB>;
    query<T = Record<string, unknown>>(sql: string, binds?: OracleBinds, options?: StatementOptions): Promise<T[]>;
    queryOne<T = Record<string, unknown>>(
        sql: string,
        binds?: OracleBinds,
        options?: StatementOptions,
    ): Promise<T | undefined>;
    execute<T = Record<string, unknown>, const B extends OracleBinds = OracleBinds>(
        sql: string,
        binds?: B,
        options?: StatementOptions,
    ): Promise<ExecuteResult<T, OutBinds<B>>>;
    executeMany(sql: string, rows: readonly OracleBinds[], options?: ExecuteManyOptions): Promise<ExecuteManyResult>;
}

/** Errors after which a connection is dropped instead of going back to the pool. */
const DROP_ON = new Set([
    'NJS-123',
    'NJS-500',
    'NJS-501',
    'NJS-003',
    'DPI-1080',
    'ORA-03113',
    'ORA-03114',
    'ORA-03135',
]);

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
    /** The server's major version (19, 21, 23…), known after start(). */
    public serverVersion: number | undefined;

    private app: App | undefined;
    private oracledb: OracledbModule | undefined;
    private config: ResolvedOracleConfig | undefined;
    private pool: OraclePoolLike | undefined;
    private fetchHandler: ReturnType<typeof fetchTypeHandler> | undefined;
    private onQuery: OnQueryHook | undefined;
    private pingInFlight: Promise<boolean> | undefined;
    /** The connection of the transaction() running in the current async context. */
    private readonly activeTx = new AsyncLocalStorage<ConnectionHandle>();

    private readonly runner: StatementRunner = {
        run: (handle, sql, binds, options) => this.run(handle, sql, binds, options),
        streamRows: (handle, sql, binds, chunkSize, options) => this.streamRows(handle, sql, binds, chunkSize, options),
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
            await this.withConnection(async (handle) => {
                await this.run(handle, 'SELECT 1 FROM DUAL', []);
                const version = handle.connection.oracleServerVersion;
                this.serverVersion = version ? Math.floor(version / 100_000_000) : undefined;
            });
            if (config.compatibility === '23ai' && this.serverVersion !== undefined && this.serverVersion < 23) {
                this.app.logger.warn(
                    { serverVersion: this.serverVersion },
                    "compatibility is '23ai' but the database is older: booleans and multi-row VALUES will fail",
                );
            }
            this.db = this.createKysely(() => this.acquire());
            this.app.logger.info({ serverVersion: this.serverVersion }, 'Oracle connected successfully.');
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
     * Register a callback for every statement and its binds (raw and Kysely);
     * it may return a function called when the statement ends (see
     * OnQueryHook). A throwing callback is ignored: observability never fails
     * a query.
     */
    setOnQuery(onQuery: OnQueryHook | undefined): void {
        this.onQuery = onQuery;
    }

    /**
     * `SELECT 1 FROM DUAL` for readiness checks: true or false within
     * `pingTimeout` (default 5 s), never throws. A ping still waiting for a
     * connection is shared by the next ones instead of queueing more.
     */
    async ping(): Promise<boolean> {
        const { pool, config } = this;
        if (!pool || !config) return false;
        this.pingInFlight ??= (async () => {
            let connection: OracleConnectionLike | undefined;
            try {
                connection = await pool.getConnection();
                connection.callTimeout = config.pingTimeout;
                await connection.execute('SELECT 1 FROM DUAL', [], {});
                return true;
            } catch {
                return false;
            } finally {
                await connection?.close({ drop: false }).catch(() => {});
            }
        })().finally(() => {
            this.pingInFlight = undefined;
        });
        let timer: ReturnType<typeof setTimeout> | undefined;
        const expired = new Promise<boolean>((resolve) => {
            timer = setTimeout(() => resolve(false), config.pingTimeout);
        });
        try {
            return await Promise.race([this.pingInFlight, expired]);
        } finally {
            clearTimeout(timer);
        }
    }

    /** The rows of a query. */
    async query<T = Record<string, unknown>>(
        sql: string,
        binds?: OracleBinds,
        options?: StatementOptions,
    ): Promise<T[]> {
        return this.withConnection(
            async (handle) => (await this.executeOn<T, OracleBinds>(handle, sql, binds, options)).rows,
        );
    }

    /** The first row of a query (fetching only that one), or undefined. */
    async queryOne<T = Record<string, unknown>>(
        sql: string,
        binds?: OracleBinds,
        options?: StatementOptions,
    ): Promise<T | undefined> {
        return this.withConnection((handle) => this.queryOneOn<T>(handle, sql, binds, options));
    }

    /**
     * Runs a statement: rows, rowsAffected and outBinds. Binds by name may
     * give a type by name: `{ id: { dir: 'returning', type: 'number' } }` for
     * `RETURNING id INTO :id`, `{ dir: 'out', type: 'string' }` for a PL/SQL
     * OUT parameter, `{ type: 'clob', val: text }` for a long IN value.
     * Outside a transaction it commits on its own; inside `transaction()` it
     * runs in the transaction.
     */
    async execute<T = Record<string, unknown>, const B extends OracleBinds = OracleBinds>(
        sql: string,
        binds?: B,
        options?: StatementOptions,
    ): Promise<ExecuteResult<T, OutBinds<B>>> {
        return this.withConnection((handle) => this.executeOn<T, B>(handle, sql, binds, options));
    }

    /**
     * Runs a DML statement once per row of binds (a bulk insert), in one round
     * trip. `bindDefs` names types (`clob` to load CLOBs) and out binds.
     */
    async executeMany(
        sql: string,
        rows: readonly OracleBinds[],
        options?: ExecuteManyOptions,
    ): Promise<ExecuteManyResult> {
        return this.withConnection((handle) => this.executeManyOn(handle, sql, rows, options));
    }

    /** The rows of a query one at a time, fetched `chunkSize` (default 100) at a time. */
    async *stream<T = Record<string, unknown>>(
        sql: string,
        binds?: OracleBinds,
        options: StatementOptions & { chunkSize?: number } = {},
    ): AsyncGenerator<T> {
        const handle = await this.acquire();
        try {
            for await (const rows of this.streamRows(handle, sql, binds, options.chunkSize ?? 100, options)) {
                for (const row of rows) yield row as T;
            }
        } finally {
            await handle.release();
        }
    }

    /**
     * Runs `fn` on one connection with autoCommit off, and commits when it
     * returns or rolls back when it throws (rethrowing its error). Inside it,
     * `oracle.query()`, `oracle.execute()`, `oracle.db`… also run in the
     * transaction (another connection could wait forever on its locks);
     * opening another transaction() throws.
     */
    async transaction<R>(fn: (tx: OracleTransaction<DB>) => Promise<R>): Promise<R> {
        if (this.activeTx.getStore()?.ended === false) {
            throw new QueryError(
                'A transaction is already open here: Oracle has no nested transactions (statements already join it)',
            );
        }
        const handle = await this.acquire();
        const pinned: ConnectionHandle = {
            connection: handle.connection,
            inTransaction: true,
            ended: false,
            release: async () => {},
        };
        const tx: OracleTransaction<DB> = {
            db: this.createKysely(async () => pinned),
            query: async <T>(sql: string, binds?: OracleBinds, options?: StatementOptions) =>
                (await this.executeOn<T, OracleBinds>(pinned, sql, binds, options)).rows,
            queryOne: <T>(sql: string, binds?: OracleBinds, options?: StatementOptions) =>
                this.queryOneOn<T>(pinned, sql, binds, options),
            execute: <T, const B extends OracleBinds>(sql: string, binds?: B, options?: StatementOptions) =>
                this.executeOn<T, B>(pinned, sql, binds, options),
            executeMany: (sql, rows, options) => this.executeManyOn(pinned, sql, rows, options),
        };
        try {
            const result = await this.activeTx.run(pinned, () => fn(tx));
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
            pinned.ended = true;
            handle.broken ||= pinned.broken;
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
     * and returns their names. Needs start(). Its statements have no
     * callTimeout: building an index may take long.
     */
    async runMigrations(dir = './migrations', options?: MigrationOptions): Promise<string[]> {
        if (!this.pool || !this.config) {
            throw new MigrationError('Cannot run migrations: the Oracle driver is not started');
        }
        const { connectString, user, password, poolAttributes } = this.config;
        return runMigrations(
            {
                connect: () => this.connect({ ...poolAttributes, connectString, user, password }),
                run: (handle, sql, binds) => this.run(handle, sql, binds, { timeout: 0 }),
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

    /** Opens a standalone connection (for migrations); tests replace it. */
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

    private ready() {
        const { oracledb, config } = this;
        if (!oracledb || !config) throw new QueryError('Oracle driver not started');
        return { oracledb, config };
    }

    private createKysely(acquire: () => Promise<ConnectionHandle>): Kysely<DB> {
        const plugins: KyselyPlugin[] = this.config?.camelCase ? [new CamelCasePlugin({ upperCase: true })] : [];
        const dialect = new OracleDialect({
            acquire,
            runner: this.runner,
            compatibility: this.config?.compatibility ?? '19c',
        });
        return new Kysely<DB>({ dialect, plugins });
    }

    /** The active transaction's connection, or one from the pool. */
    private async acquire(): Promise<ConnectionHandle> {
        const active = this.activeTx.getStore();
        // Work left running after the transaction ended goes to the pool.
        if (active && !active.ended) return active;
        const pool = this.pool;
        if (!pool) throw new QueryError('Oracle driver not started');
        let connection: OracleConnectionLike;
        try {
            connection = await pool.getConnection();
        } catch (error) {
            throw toQueryError(error);
        }
        const handle: ConnectionHandle = {
            connection,
            inTransaction: false,
            release: async () => {
                try {
                    await connection.close({ drop: handle.broken === true });
                } catch (error) {
                    this.app?.logger.warn({ error }, 'Failed to release an Oracle connection');
                }
            },
        };
        return handle;
    }

    private async withConnection<R>(fn: (handle: ConnectionHandle) => Promise<R>): Promise<R> {
        const handle = await this.acquire();
        try {
            return await fn(handle);
        } finally {
            await handle.release();
        }
    }

    private options(handle: ConnectionHandle): Record<string, unknown> {
        const { oracledb } = this.ready();
        return {
            outFormat: oracledb.OUT_FORMAT_OBJECT,
            autoCommit: !handle.inTransaction,
            fetchTypeHandler: this.fetchHandler,
        };
    }

    /** Calls the OnQuery hook; returns what to call when the statement ends. */
    private startHook(sql: string, binds: unknown): (info: Omit<QueryEnd, 'durationMs'>) => void {
        const started = performance.now();
        let end: ((end: QueryEnd) => void) | undefined;
        try {
            const returned = this.onQuery?.(sql, binds);
            if (typeof returned === 'function') end = returned as (end: QueryEnd) => void;
        } catch {
            // Observability must never break the query.
        }
        return (info) => {
            try {
                end?.({ durationMs: performance.now() - started, ...info });
            } catch {
                // Observability must never break the query.
            }
        };
    }

    /** A statement's error as a QueryError; a timeout or a lost connection marks the connection to be dropped. */
    private failed(handle: ConnectionHandle, caught: unknown): QueryError {
        const error = toQueryError(caught);
        if (error.errorCode && DROP_ON.has(error.errorCode)) handle.broken = true;
        return error;
    }

    /**
     * Sets the statement's timeout and abort signal on its connection;
     * returns what undoes them. An already aborted signal throws.
     */
    private arm(handle: ConnectionHandle, options: StatementOptions | undefined): () => void {
        const { config } = this.ready();
        const { connection } = handle;
        const signal = options?.signal;
        if (signal?.aborted) {
            throw new QueryError('The statement was aborted before it ran', { context: { errorCode: 'ORA-01013' } });
        }
        const onAbort = () => void connection.breakExecution?.().catch(() => {});
        signal?.addEventListener('abort', onAbort, { once: true });
        connection.callTimeout = options?.timeout ?? config.callTimeout;
        return () => {
            signal?.removeEventListener('abort', onAbort);
            connection.callTimeout = config.callTimeout;
        };
    }

    /** Runs `call` on `handle` armed with the statement's options, the OnQuery hook around it. */
    private async observe<R>(
        handle: ConnectionHandle,
        sql: string,
        binds: unknown,
        options: StatementOptions | undefined,
        call: () => Promise<R>,
        counts: (result: R) => Omit<QueryEnd, 'durationMs' | 'error'>,
    ): Promise<R> {
        const finish = this.startHook(sql, binds);
        let disarm: (() => void) | undefined;
        try {
            disarm = this.arm(handle, options);
            const result = await call();
            finish(counts(result));
            return result;
        } catch (caught) {
            const error = this.failed(handle, caught);
            finish({ error });
            throw error;
        } finally {
            disarm?.();
        }
    }

    private async run(
        handle: ConnectionHandle,
        sql: string,
        binds: unknown,
        options?: StatementOptions,
        extra: Record<string, unknown> = {},
    ): Promise<OracleRawResult> {
        const { oracledb, config } = this.ready();
        const oracleBinds = toOracleBinds(oracledb, binds as OracleBinds, {
            sql,
            dropUnused: options?.dropUnusedBinds ?? config.dropUnusedBinds,
        });
        return this.observe(
            handle,
            sql,
            binds,
            options,
            () => handle.connection.execute(sql, oracleBinds, { ...this.options(handle), ...extra }),
            (result) => ({ rows: result.rows?.length, rowsAffected: result.rowsAffected }),
        );
    }

    private async executeOn<T, B>(
        handle: ConnectionHandle,
        sql: string,
        binds: B | undefined,
        options?: StatementOptions,
    ): Promise<ExecuteResult<T, OutBinds<B>>> {
        const result = await this.run(handle, sql, binds, options);
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
            ...(result.warning ? { warning: result.warning.message ?? String(result.warning.code) } : {}),
        };
    }

    private async queryOneOn<T>(
        handle: ConnectionHandle,
        sql: string,
        binds: OracleBinds | undefined,
        options?: StatementOptions,
    ): Promise<T | undefined> {
        const result = await this.run(handle, sql, binds, options, { maxRows: 1 });
        return result.rows?.[0] as T | undefined;
    }

    private async executeManyOn(
        handle: ConnectionHandle,
        sql: string,
        rows: readonly OracleBinds[],
        options?: ExecuteManyOptions,
    ): Promise<ExecuteManyResult> {
        const { oracledb } = this.ready();
        const prepared = toExecuteMany(oracledb, rows, options?.bindDefs);
        const result = await this.observe(
            handle,
            sql,
            rows,
            options,
            () =>
                handle.connection.executeMany(sql, prepared.rows, {
                    ...this.options(handle),
                    ...(prepared.bindDefs ? { bindDefs: prepared.bindDefs } : {}),
                }),
            (r) => ({ rowsAffected: r.rowsAffected }),
        );
        let outBinds: unknown[];
        try {
            outBinds = await Promise.all((result.outBinds ?? []).map(readOutBinds));
        } catch (error) {
            throw toQueryError(error, 'Failed to read a LOB out bind');
        }
        return { rowsAffected: result.rowsAffected ?? 0, outBinds };
    }

    private async *streamRows(
        handle: ConnectionHandle,
        sql: string,
        binds: unknown,
        chunkSize: number,
        options?: StatementOptions,
    ): AsyncGenerator<unknown[]> {
        const { oracledb, config } = this.ready();
        const oracleBinds = toOracleBinds(oracledb, binds as OracleBinds, {
            sql,
            dropUnused: options?.dropUnusedBinds ?? config.dropUnusedBinds,
        });
        // One hook call for the whole stream: the execute and every fetch.
        const finish = this.startHook(sql, binds);
        let total = 0;
        let failure: QueryError | undefined;
        let disarm: (() => void) | undefined;
        let resultSet: OracleResultSetLike | undefined;
        try {
            disarm = this.arm(handle, options);
            try {
                const result = await handle.connection.execute(sql, oracleBinds, {
                    ...this.options(handle),
                    resultSet: true,
                });
                resultSet = result.resultSet;
            } catch (caught) {
                throw this.failed(handle, caught);
            }
            if (!resultSet) throw new QueryError('stream() needs a query that returns rows');
            for (;;) {
                let rows: unknown[];
                try {
                    rows = await resultSet.getRows(chunkSize);
                } catch (caught) {
                    throw this.failed(handle, caught);
                }
                if (rows.length === 0) return;
                total += rows.length;
                yield rows;
            }
        } catch (error) {
            failure = error as QueryError;
            throw error;
        } finally {
            disarm?.();
            await resultSet?.close().catch(() => {});
            finish(failure ? { error: failure } : { rows: total });
        }
    }
}

// `app.context.get('oracle')` is the OracleDriver registered on the app.
declare module '@iskra-bun/core' {
    interface AppContextRegistry {
        oracle: OracleDriver;
    }
}
