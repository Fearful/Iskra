import {
    DefaultQueryCompiler,
    DialectAdapterBase,
    FromNode,
    IdentifierNode,
    MatchedNode,
    MergeQueryNode,
    OperationNodeTransformer,
    RawNode,
    TableNode,
    ValuesNode,
    createQueryId,
    type AliasNode,
    type CompiledQuery,
    type DatabaseConnection,
    type DatabaseIntrospector,
    type Dialect,
    type Driver,
    type FetchNode,
    type InsertQueryNode,
    type JoinNode,
    type OffsetNode,
    type QueryCompiler,
    type QueryId,
    type QueryResult,
    type RootOperationNode,
    type SelectQueryNode,
    type TransactionSettings,
    type WhenNode,
} from 'kysely';
import type { OracleCompatibility } from './config';
import type { ConnectionHandle, OracleRawResult } from './types';

/** How the Kysely driver runs statements: through the OracleDriver, so hooks, binds and errors are shared. */
export interface StatementRunner {
    run(
        handle: ConnectionHandle,
        sql: string,
        binds: unknown,
        options?: { signal?: AbortSignal },
    ): Promise<OracleRawResult>;
    streamRows(
        handle: ConnectionHandle,
        sql: string,
        binds: unknown,
        chunkSize: number,
        options?: { signal?: AbortSignal },
    ): AsyncGenerator<unknown[]>;
    /** Commits or rolls back, bounded like a statement. */
    end(handle: ConnectionHandle, action: 'commit' | 'rollback'): Promise<void>;
}

export interface OracleDialectOptions {
    acquire(): Promise<ConnectionHandle>;
    runner: StatementRunner;
    compatibility: OracleCompatibility;
}

const NOT_ON_19C = "(Oracle 23ai only; the driver's compatibility is '19c')";

/**
 * Rewrites what Oracle spells differently before compiling: a select's
 * `limit(n)` becomes `fetch next n rows only` (Oracle has no LIMIT), a select
 * without FROM reads FROM DUAL (required before 23ai), and with 19c
 * compatibility an INSERT of several rows is refused (multi-row VALUES is 23ai).
 */
class OracleNodes extends OperationNodeTransformer {
    constructor(private readonly compatibility: OracleCompatibility) {
        super();
    }

    protected override transformSelectQuery(node: SelectQueryNode, queryId?: QueryId): SelectQueryNode {
        let query = super.transformSelectQuery(node, queryId);
        if (!query.from) query = { ...query, from: FromNode.create([TableNode.create('DUAL')]) };
        if (!query.limit) return query;
        if (query.fetch) throw new Error('Oracle: use limit() or fetch() in a query, not both');
        const fetch = { kind: 'FetchNode', rowCount: query.limit.limit, modifier: 'only' } as FetchNode;
        return { ...query, limit: undefined, fetch };
    }

    protected override transformInsertQuery(node: InsertQueryNode, queryId?: QueryId): InsertQueryNode {
        const query = super.transformInsertQuery(node, queryId);
        if (
            this.compatibility === '19c' &&
            query.values &&
            ValuesNode.is(query.values) &&
            query.values.values.length > 1
        ) {
            throw new Error(
                `Oracle: an INSERT of several rows with VALUES ${NOT_ON_19C}: insert one row at a time or use executeMany()`,
            );
        }
        return query;
    }
}

export class OracleQueryCompiler extends DefaultQueryCompiler {
    readonly #nodes: OracleNodes;

    constructor(private readonly compatibility: OracleCompatibility = '19c') {
        super();
        this.#nodes = new OracleNodes(compatibility);
    }

    override compileQuery(node: RootOperationNode, queryId: QueryId): CompiledQuery {
        return super.compileQuery(this.#nodes.transformNode(node, queryId), queryId);
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

    // MERGE … USING t ON (condition): Oracle requires the parentheses.
    protected override visitJoin(node: JoinNode): void {
        if (node.joinType !== 'Using' || !node.on) return super.visitJoin(node);
        this.append('using ');
        this.visitNode(node.table);
        this.append(' on (');
        this.visitNode(node.on.on);
        this.append(')');
    }

    // Oracle's MERGE has WHEN MATCHED THEN UPDATE and WHEN NOT MATCHED THEN INSERT only.
    protected override visitWhen(node: WhenNode): void {
        if (this.parentNode && MergeQueryNode.is(this.parentNode)) {
            if (!MatchedNode.is(node.condition) || node.condition.bySource) {
                throw new Error(
                    'Oracle MERGE takes WHEN MATCHED and WHEN NOT MATCHED only: no extra AND condition ' +
                        '(put it in a WHERE of the update) and no BY SOURCE',
                );
            }
            if (!node.result || RawNode.is(node.result)) {
                throw new Error(
                    'Oracle MERGE takes THEN UPDATE and THEN INSERT only: no thenDelete() or thenDoNothing()',
                );
            }
        }
        super.visitWhen(node);
    }

    protected override visitReturning(): void {
        throw new Error("Oracle has no RETURNING clause in Kysely: use execute() with { dir: 'returning' } binds");
    }

    protected override visitOnConflict(): void {
        throw new Error('Oracle has no ON CONFLICT: use mergeInto()');
    }

    protected override visitOnDuplicateKey(): void {
        throw new Error('Oracle has no ON DUPLICATE KEY UPDATE: use mergeInto()');
    }

    protected override appendValue(parameter: unknown): void {
        this.#checkBoolean(parameter);
        super.appendValue(parameter);
    }

    protected override appendImmediateValue(value: unknown): void {
        this.#checkBoolean(value);
        super.appendImmediateValue(value);
    }

    #checkBoolean(value: unknown) {
        if (typeof value === 'boolean' && this.compatibility === '19c') {
            throw new Error(`Oracle: a boolean in SQL ${NOT_ON_19C}: use 1/0 (NUMBER(1)) or 'Y'/'N'`);
        }
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

    async executeQuery<R>(compiledQuery: CompiledQuery, options?: { signal?: AbortSignal }): Promise<QueryResult<R>> {
        const result = await this.runner.run(this.handle, compiledQuery.sql, compiledQuery.parameters, {
            signal: options?.signal,
        });
        return {
            rows: (result.rows ?? []) as R[],
            ...(result.rowsAffected !== undefined ? { numAffectedRows: BigInt(result.rowsAffected) } : {}),
        };
    }

    async *streamQuery<R>(
        compiledQuery: CompiledQuery,
        chunkSize: number,
        options?: { signal?: AbortSignal },
    ): AsyncIterableIterator<QueryResult<R>> {
        const chunks = this.runner.streamRows(this.handle, compiledQuery.sql, compiledQuery.parameters, chunkSize, {
            signal: options?.signal,
        });
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
            await this.options.runner.end(handle, 'commit');
        } finally {
            handle.inTransaction = false;
        }
    }

    async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
        const { handle } = connection as OracleKyselyConnection;
        try {
            await this.options.runner.end(handle, 'rollback');
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
        return new OracleQueryCompiler(this.options.compatibility);
    }

    createAdapter() {
        return new OracleAdapter();
    }

    createIntrospector(): DatabaseIntrospector {
        return new OracleIntrospector();
    }
}
