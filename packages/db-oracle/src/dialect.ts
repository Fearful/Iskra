import {
    DefaultQueryCompiler,
    DialectAdapterBase,
    IdentifierNode,
    OperationNodeTransformer,
    RawNode,
    createQueryId,
    type AliasNode,
    type CompiledQuery,
    type DatabaseConnection,
    type DatabaseIntrospector,
    type Dialect,
    type Driver,
    type FetchNode,
    type OffsetNode,
    type QueryCompiler,
    type QueryId,
    type QueryResult,
    type RootOperationNode,
    type SelectQueryNode,
    type TransactionSettings,
} from 'kysely';
import type { ConnectionHandle, OracleRawResult } from './types';

/** How the Kysely driver runs statements: through the OracleDriver, so hooks, binds and errors are shared. */
export interface StatementRunner {
    run(handle: ConnectionHandle, sql: string, binds: unknown): Promise<OracleRawResult>;
    streamRows(handle: ConnectionHandle, sql: string, binds: unknown, chunkSize: number): AsyncGenerator<unknown[]>;
}

export interface OracleDialectOptions {
    acquire(): Promise<ConnectionHandle>;
    runner: StatementRunner;
}

/** `limit(n)` of a select becomes `fetch next n rows only`: Oracle has no LIMIT. */
class LimitToFetch extends OperationNodeTransformer {
    protected override transformSelectQuery(node: SelectQueryNode, queryId?: QueryId): SelectQueryNode {
        const query = super.transformSelectQuery(node, queryId);
        if (!query.limit) return query;
        if (query.fetch) throw new Error('Oracle: use limit() or fetch() in a query, not both');
        const fetch = { kind: 'FetchNode', rowCount: query.limit.limit, modifier: 'only' } as FetchNode;
        return { ...query, limit: undefined, fetch };
    }
}

export class OracleQueryCompiler extends DefaultQueryCompiler {
    readonly #limitToFetch = new LimitToFetch();

    override compileQuery(node: RootOperationNode, queryId: QueryId): CompiledQuery {
        return super.compileQuery(this.#limitToFetch.transformNode(node, queryId), queryId);
    }

    protected override getCurrentParameterPlaceholder(): string {
        return `:${this.numParameters}`;
    }

    // Oracle takes no AS before a table alias.
    protected override visitAlias(node: AliasNode): void {
        this.visitNode(node.node);
        this.append(' ');
        this.visitNode(node.alias);
    }

    protected override visitOffset(node: OffsetNode): void {
        this.append('offset ');
        this.visitNode(node.offset);
        this.append(' rows');
    }

    // Only reached by an UPDATE or DELETE: a select's limit became a fetch.
    protected override visitLimit(): void {
        throw new Error('Oracle has no LIMIT clause for UPDATE or DELETE: filter the rows in the WHERE clause');
    }
}

class OracleAdapter extends DialectAdapterBase {
    async acquireMigrationLock(): Promise<void> {
        throw new Error("Kysely's Migrator is not supported with Oracle: use OracleDriver.runMigrations()");
    }

    async releaseMigrationLock(): Promise<void> {}
}

class OracleIntrospector implements DatabaseIntrospector {
    #unsupported(): Promise<never> {
        return Promise.reject(
            new Error('Introspection is not supported: generate the DB types with kysely-oracledb (see the docs)'),
        );
    }

    getSchemas() {
        return this.#unsupported();
    }

    getTables() {
        return this.#unsupported();
    }

    getMetadata() {
        return this.#unsupported();
    }
}

class OracleKyselyConnection implements DatabaseConnection {
    constructor(
        readonly handle: ConnectionHandle,
        private readonly runner: StatementRunner,
    ) {}

    async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
        const result = await this.runner.run(this.handle, compiledQuery.sql, compiledQuery.parameters);
        return {
            rows: (result.rows ?? []) as R[],
            ...(result.rowsAffected !== undefined ? { numAffectedRows: BigInt(result.rowsAffected) } : {}),
        };
    }

    async *streamQuery<R>(compiledQuery: CompiledQuery, chunkSize: number): AsyncIterableIterator<QueryResult<R>> {
        const chunks = this.runner.streamRows(this.handle, compiledQuery.sql, compiledQuery.parameters, chunkSize);
        for await (const rows of chunks) yield { rows: rows as R[] };
    }
}

function savepointCommand(command: string, name: string) {
    return RawNode.createWithChildren([RawNode.createWithSql(`${command} `), IdentifierNode.create(name)]);
}

class OracleKyselyDriver implements Driver {
    constructor(private readonly options: OracleDialectOptions) {}

    async init(): Promise<void> {}

    async acquireConnection(): Promise<DatabaseConnection> {
        return new OracleKyselyConnection(await this.options.acquire(), this.options.runner);
    }

    async beginTransaction(connection: DatabaseConnection, settings: TransactionSettings): Promise<void> {
        const { handle } = connection as OracleKyselyConnection;
        if (handle.inTransaction) {
            throw new Error('A transaction is already open on this connection: Oracle has no nested transactions');
        }
        if (settings.accessMode && settings.isolationLevel) {
            throw new Error('Oracle sets either an access mode or an isolation level on a transaction, not both');
        }
        const level = settings.isolationLevel;
        if (level && level !== 'read committed' && level !== 'serializable') {
            throw new Error(`Oracle supports the read committed and serializable isolation levels, not ${level}`);
        }
        handle.inTransaction = true;
        const clause = settings.accessMode ?? (level ? `isolation level ${level}` : undefined);
        if (clause) {
            try {
                await this.options.runner.run(handle, `set transaction ${clause}`, []);
            } catch (error) {
                handle.inTransaction = false;
                throw error;
            }
        }
    }

    async commitTransaction(connection: DatabaseConnection): Promise<void> {
        const { handle } = connection as OracleKyselyConnection;
        try {
            await handle.connection.commit();
        } finally {
            handle.inTransaction = false;
        }
    }

    async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
        const { handle } = connection as OracleKyselyConnection;
        try {
            await handle.connection.rollback();
        } finally {
            handle.inTransaction = false;
        }
    }

    async savepoint(connection: DatabaseConnection, name: string, compile: QueryCompiler['compileQuery']) {
        const { handle } = connection as OracleKyselyConnection;
        const query = compile(savepointCommand('savepoint', name), createQueryId());
        await this.options.runner.run(handle, query.sql, []);
    }

    async rollbackToSavepoint(connection: DatabaseConnection, name: string, compile: QueryCompiler['compileQuery']) {
        const { handle } = connection as OracleKyselyConnection;
        const query = compile(savepointCommand('rollback to savepoint', name), createQueryId());
        await this.options.runner.run(handle, query.sql, []);
    }

    // Oracle has no RELEASE SAVEPOINT: a savepoint lasts until the transaction ends.
    async releaseSavepoint(): Promise<void> {}

    async releaseConnection(connection: DatabaseConnection): Promise<void> {
        await (connection as OracleKyselyConnection).handle.release();
    }

    // The OracleDriver owns the pool and closes it in stop().
    async destroy(): Promise<void> {}
}

export class OracleDialect implements Dialect {
    constructor(private readonly options: OracleDialectOptions) {}

    createDriver(): Driver {
        return new OracleKyselyDriver(this.options);
    }

    createQueryCompiler(): QueryCompiler {
        return new OracleQueryCompiler();
    }

    createAdapter() {
        return new OracleAdapter();
    }

    createIntrospector(): DatabaseIntrospector {
        return new OracleIntrospector();
    }
}
