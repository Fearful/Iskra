/**
 * `@iskra-bun/db-oracle/testing`: an OracleSession for repository tests,
 * answered by SQL matchers instead of a database.
 */
import type { OracleBinds } from './binds';
import type {
    ExecuteManyResult,
    ExecuteResult,
    OracleDatabase,
    OracleSession,
    QueryOptions,
    StatementOptions,
} from './driver';
import { NoRowsError } from './errors';
import { listRows, type ListOptions, type ListResult } from './list';
import { decodeRows } from './rows';

/** A statement the fake received, as the repository wrote it. */
export interface FakeCall {
    method: 'query' | 'queryOne' | 'one' | 'execute' | 'executeMany';
    sql: string;
    binds: unknown;
}

type Matcher = string | RegExp | ((sql: string, binds: unknown) => boolean);

/** What a matched statement answers: rows, a full result, or a function of the call. */
export type FakeAnswer =
    | readonly Record<string, unknown>[]
    | Partial<ExecuteResult<Record<string, unknown>, unknown>>
    | ((sql: string, binds: unknown) => unknown);

interface Rule {
    matcher: Matcher;
    answer?: FakeAnswer;
    error?: unknown;
    once: boolean;
    used: number;
}

/** Whitespace and case do not matter to a string matcher. */
const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim().toLowerCase();

const COUNT = /^SELECT COUNT\(\*\) AS "ISKRA_TOTAL" FROM \(\n([\s\S]*)\n\) iskra_count$/;
const PAGE = /\nOFFSET :iskra_offset ROWS FETCH NEXT :iskra_limit ROWS ONLY$/;

export interface FakeRule {
    /** Answers with these rows (or result, or function of the call). */
    reply(answer: FakeAnswer): FakeRule;
    /** Fails with this error (a `QueryError`, an `Error` shaped like node-oracledb's…). */
    fail(error: unknown): FakeRule;
    /** Answers only the next matching statement. */
    once(): FakeRule;
}

export interface FakeOracle extends OracleDatabase {
    /**
     * Answers the statements `matcher` takes: a string contained in the SQL
     * (ignoring case and whitespace), a RegExp, or a function of the SQL and
     * binds. The latest rule that matches wins.
     */
    on(matcher: Matcher): FakeRule;
    /** Every statement it received, in order. */
    readonly calls: FakeCall[];
    /** Commits and rollbacks of `transaction()`. */
    readonly commits: number;
    readonly rollbacks: number;
    /** Runs `fn` with the fake itself; commits when it returns, rolls back when it throws. */
    transaction<R>(fn: (tx: OracleSession) => Promise<R>): Promise<R>;
    /** Throws, naming them, if some rules never matched a statement. */
    expectAllMatched(): void;
    /** Clears the calls and the counters (the rules stay). */
    reset(): void;
}

/**
 * A fake OracleSession: type a repository against `OracleSession` and hand
 * it this in tests. A statement no rule answers throws, so a test names every
 * query it expects. `list()` runs as the driver's does: the counts are the
 * rows the page's query answers, and the page is sliced from them.
 *
 * ```ts
 * const oracle = fakeOracle();
 * oracle.on(/FROM usuarios WHERE id = :id/).reply([{ ID: 1, NOMBRE: 'Ana' }]);
 * expect(await new UsuariosRepo(oracle).buscar(1)).toEqual({ id: 1, nombre: 'Ana' });
 * expect(oracle.calls[0].binds).toEqual({ id: 1 });
 * ```
 */
export function fakeOracle(): FakeOracle {
    const rules: Rule[] = [];
    const calls: FakeCall[] = [];
    let commits = 0;
    let rollbacks = 0;

    const matches = (rule: Rule, sql: string, binds: unknown) =>
        typeof rule.matcher === 'string'
            ? normalize(sql).includes(normalize(rule.matcher))
            : rule.matcher instanceof RegExp
              ? rule.matcher.test(sql)
              : rule.matcher(sql, binds);

    /** The result of the latest rule that matches, or a throw. */
    const answer = async (sql: string, binds: unknown): Promise<ExecuteResult<Record<string, unknown>, unknown>> => {
        const rule = [...rules].reverse().find((r) => !(r.once && r.used > 0) && matches(r, sql, binds));
        if (!rule) throw new Error(`fakeOracle: no rule answers this statement:\n${sql}`);
        rule.used++;
        if (rule.error !== undefined) throw rule.error;
        const value = typeof rule.answer === 'function' ? await rule.answer(sql, binds) : rule.answer;
        if (Array.isArray(value)) return { rows: [...value], rowsAffected: 0, outBinds: {} };
        const result = (value ?? {}) as Partial<ExecuteResult<Record<string, unknown>, unknown>>;
        return { rows: result.rows ?? [], rowsAffected: result.rowsAffected ?? 0, outBinds: result.outBinds ?? {} };
    };

    const run = async (method: FakeCall['method'], sql: string, binds: unknown) => {
        calls.push({ method, sql, binds });
        return answer(sql, binds);
    };

    /** list()'s statements: a count or a page, answered from the rows of the page's own query. */
    const listRunner = async (sql: string, params: Readonly<Record<string, unknown>>) => {
        const count = COUNT.exec(sql);
        if (count) return [{ ISKRA_TOTAL: (await run('query', count[1]!, params)).rows.length }];
        if (!PAGE.test(sql)) return (await run('query', sql, params)).rows;
        const { iskra_offset: offset, iskra_limit: limit, ...rest } = params as Record<string, number>;
        const rows = (await run('query', sql.replace(PAGE, ''), rest)).rows;
        return rows.slice(offset, offset + limit);
    };

    const session: FakeOracle = {
        on(matcher) {
            const rule: Rule = { matcher, once: false, used: 0 };
            rules.push(rule);
            const api: FakeRule = {
                reply: (value) => ((rule.answer = value), api),
                fail: (error) => ((rule.error = error), api),
                once: () => ((rule.once = true), api),
            };
            return api;
        },
        calls,
        get commits() {
            return commits;
        },
        get rollbacks() {
            return rollbacks;
        },
        async query<T>(sql: string, binds?: OracleBinds, options?: QueryOptions<T>) {
            const { rows } = await run('query', sql, binds);
            return options?.rows ? decodeRows(rows, options.rows) : (rows as T[]);
        },
        async queryOne<T>(sql: string, binds?: OracleBinds, options?: QueryOptions<T>) {
            const [row] = (await run('queryOne', sql, binds)).rows;
            if (row === undefined || !options?.rows) return row as T | undefined;
            return (await decodeRows([row], options.rows))[0];
        },
        async one<T>(sql: string, binds?: OracleBinds, options?: QueryOptions<T>) {
            const [row] = (await run('one', sql, binds)).rows;
            if (row === undefined) throw new NoRowsError();
            return options?.rows ? (await decodeRows([row], options.rows))[0]! : (row as T);
        },
        async execute<T, B>(sql: string, binds?: B, _options?: StatementOptions) {
            return (await run('execute', sql, binds)) as unknown as ExecuteResult<T, never>;
        },
        async executeMany(sql: string, rows: readonly OracleBinds[]): Promise<ExecuteManyResult> {
            const result = await run('executeMany', sql, rows);
            return { rowsAffected: result.rowsAffected || rows.length, outBinds: [] };
        },
        list<T, F, O>(options: ListOptions<T, F, O>, _statement?: StatementOptions): Promise<ListResult<T>> {
            return listRows(listRunner, options);
        },
        async transaction<R>(fn: (tx: OracleSession) => Promise<R>): Promise<R> {
            try {
                const result = await fn(session);
                commits++;
                return result;
            } catch (error) {
                rollbacks++;
                throw error;
            }
        },
        async ping() {
            return true;
        },
        expectAllMatched() {
            const unused = rules.filter((r) => r.used === 0).map((r) => String(r.matcher));
            if (unused.length > 0) throw new Error(`fakeOracle: rules never matched:\n  ${unused.join('\n  ')}`);
        },
        reset() {
            calls.length = 0;
            commits = 0;
            rollbacks = 0;
            for (const rule of rules) rule.used = 0;
        },
    };
    return session;
}
