import { sql, type Kysely, type RawBuilder, type SelectQueryBuilder, type SqlBool, type StringReference } from 'kysely';
import { QueryInputError } from './errors';

export interface PageOptions {
    /** 1-based page number; a string from a query string is fine. Default 1. */
    page?: number | string | null;
    /** Rows per page. Default `defaultPageSize`, at most `maxPageSize`. */
    pageSize?: number | string | null;
    /** Default 20. */
    defaultPageSize?: number;
    /** Default 100: a request cannot ask for a million rows at once. */
    maxPageSize?: number;
}

export interface Page<T> {
    items: T[];
    /** Rows the query matches across all pages. */
    total: number;
    page: number;
    pageSize: number;
    /** Number of pages: `ceil(total / pageSize)`. */
    pages: number;
}

export interface CursorPageOptions<K extends string> extends Omit<PageOptions, 'page'> {
    /**
     * Columns the rows are ordered by, selected under their own names. They
     * must not be NULL, and together unique: end with the primary key.
     */
    keys: readonly [K, ...K[]];
    /** Default 'asc'. */
    direction?: 'asc' | 'desc';
    /** The `nextCursor` of the previous page; none for the first. */
    after?: string | null;
}

export interface CursorPage<T> {
    items: T[];
    /** Pass as `after` for the next page; null on the last one. */
    nextCursor: string | null;
    pageSize: number;
}

const MAX_PAGE = 1_000_000_000;
const MAX_CURSOR_LENGTH = 4096;

function toInt(value: number | string | null | undefined, fallback: number): number {
    if (value === null || value === undefined || value === '') return fallback;
    const n = typeof value === 'string' ? Number(value.trim()) : value;
    return Number.isFinite(n) ? Math.floor(n) : fallback;
}

/** The page and page size of `options`, clamped to valid values (bad input falls back to the defaults). */
export function pageParams(options: PageOptions = {}): { page: number; pageSize: number } {
    const max = Math.max(1, options.maxPageSize ?? 100);
    const fallback = Math.min(max, Math.max(1, options.defaultPageSize ?? 20));
    return {
        page: Math.min(MAX_PAGE, Math.max(1, toInt(options.page, 1))),
        pageSize: Math.min(max, Math.max(1, toInt(options.pageSize, fallback))),
    };
}

function checkUnpaged(
    query: { toOperationNode(): { limit?: unknown; offset?: unknown; fetch?: unknown } },
    fn: string,
) {
    const node = query.toOperationNode();
    if (node.limit || node.offset || node.fetch) {
        throw new Error(`${fn}(): leave limit, offset and fetch out of the query; ${fn}() adds them`);
    }
}

/**
 * One page of `query` and the total it matches, with OFFSET … FETCH NEXT.
 * The query needs an orderBy (end it with a unique column): Oracle returns
 * rows in no set order without one, so pages would repeat or skip rows. Runs
 * the page and a count on `db`, which may be a transaction's.
 */
export async function paginate<DB, TB extends keyof DB, O>(
    db: Kysely<DB>,
    query: SelectQueryBuilder<DB, TB, O>,
    options: PageOptions = {},
): Promise<Page<O>> {
    if (!query.toOperationNode().orderBy) {
        throw new Error('paginate(): the query needs an orderBy; Oracle returns rows in no set order without one');
    }
    checkUnpaged(query, 'paginate');
    const { page, pageSize } = pageParams(options);
    const [items, count] = await Promise.all([
        query
            .offset((page - 1) * pageSize)
            .fetch(pageSize)
            .execute(),
        sql<{ total: number | string }>`select count(*) as "total" from ${query.clearOrderBy()} iskra_page`.execute(db),
    ]);
    const total = Number(count.rows[0]?.total ?? 0);
    return { items, total, page, pageSize, pages: Math.ceil(total / pageSize) };
}

type CursorValue = string | number | boolean | Date;

/** A cursor for the key values of a row: opaque base64url JSON. */
export function encodeCursor(values: readonly unknown[]): string {
    const json = values.map((v) => (v instanceof Date ? { d: v.toISOString() } : v));
    return Buffer.from(JSON.stringify(json)).toString('base64url');
}

/** The key values of a cursor; throws a QueryInputError (a 400) for a malformed or tampered one. */
export function decodeCursor(cursor: string, length: number): CursorValue[] {
    const invalid = () => new QueryInputError('Invalid pagination cursor');
    if (cursor.length > MAX_CURSOR_LENGTH) throw invalid();
    let parsed: unknown;
    try {
        parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    } catch {
        throw invalid();
    }
    if (!Array.isArray(parsed) || parsed.length !== length) throw invalid();
    return parsed.map((value: unknown) => {
        if (typeof value === 'string' || typeof value === 'boolean') return value;
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (typeof value === 'object' && value !== null && Object.keys(value).length === 1) {
            const iso = (value as { d?: unknown }).d;
            const date = typeof iso === 'string' ? new Date(iso) : undefined;
            if (date && !Number.isNaN(date.getTime())) return date;
        }
        throw invalid();
    });
}

/** `(k1 > v1) or (k1 = v1 and k2 > v2) or …`: Oracle has no row-value comparison. */
function afterKeys(keys: readonly string[], values: readonly CursorValue[], direction: 'asc' | 'desc') {
    const op = sql.raw(direction === 'asc' ? '>' : '<');
    const branches = keys.map((key, i) => {
        const equal = keys.slice(0, i).map((k, j) => sql`${sql.ref(k)} = ${values[j]}`);
        return sql`(${sql.join([...equal, sql`${sql.ref(key)} ${op} ${values[i]}`], sql` and `)})`;
    });
    return sql<SqlBool>`(${sql.join(branches, sql` or `)})`;
}

/**
 * One page of `query` after a cursor (keyset pagination): unlike OFFSET, a
 * deep page costs no more than the first, and rows inserted meanwhile do not
 * shift the pages. The query is ordered by `keys`; leave orderBy out.
 */
export async function paginateByCursor<DB, TB extends keyof DB, O, K extends keyof O & string>(
    query: SelectQueryBuilder<DB, TB, O>,
    options: CursorPageOptions<K>,
): Promise<CursorPage<O>> {
    if (query.toOperationNode().orderBy) {
        throw new Error('paginateByCursor(): the rows are ordered by its keys; leave orderBy out of the query');
    }
    checkUnpaged(query, 'paginateByCursor');
    const { pageSize } = pageParams(options);
    const direction = options.direction ?? 'asc';
    let q = query;
    if (options.after)
        q = q.where(afterKeys(options.keys, decodeCursor(options.after, options.keys.length), direction));
    for (const key of options.keys) q = q.orderBy(sql.ref(key), direction);
    const rows = await q.fetch(pageSize + 1).execute();
    const items = rows.slice(0, pageSize);
    const last = items.at(-1);
    const nextCursor = rows.length > pageSize && last ? encodeCursor(options.keys.map((k) => last[k])) : null;
    return { items, nextCursor, pageSize };
}

/** `text` with LIKE's wildcards (`%`, `_`) and the escape character (`\`) escaped. */
export function escapeLike(text: string): string {
    return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Rows where any of `columns` contains `term`, ignoring case:
 * `upper(col) like upper('%term%') escape '\'`. The term is a bind, and its
 * `%` and `_` match themselves. An empty term leaves the query as it is.
 */
export function search<DB, TB extends keyof DB, O>(
    query: SelectQueryBuilder<DB, TB, O>,
    columns: readonly StringReference<DB, TB>[],
    term: string | null | undefined,
): SelectQueryBuilder<DB, TB, O> {
    const text = term?.trim();
    if (!text) return query;
    if (columns.length === 0) throw new Error('search(): name at least one column');
    const pattern = `%${escapeLike(text.toUpperCase())}%`;
    const matches: RawBuilder<unknown>[] = columns.map((c) => sql`upper(${sql.ref(c)}) like ${pattern} escape '\\'`);
    return query.where(sql<SqlBool>`(${sql.join(matches, sql` or `)})`);
}

/**
 * Orders `query` by a sort parameter such as `name,-createdAt` (`-` for
 * descending), taking only fields in `allowed`: any other throws a
 * QueryInputError (a 400). Add a unique column after it to break ties.
 */
export function sortBy<DB, TB extends keyof DB, O, F extends StringReference<DB, TB>>(
    query: SelectQueryBuilder<DB, TB, O>,
    sort: string | null | undefined,
    allowed: readonly F[],
): SelectQueryBuilder<DB, TB, O> {
    if (!sort?.trim()) return query;
    const seen = new Set<string>();
    let q = query;
    for (const part of sort.split(',')) {
        const field = part.trim();
        if (!field) continue;
        const desc = field.startsWith('-');
        const name = desc ? field.slice(1) : field;
        if (!(allowed as readonly string[]).includes(name))
            throw new QueryInputError(`Cannot sort by "${name.slice(0, 64)}"`);
        if (seen.has(name)) continue;
        seen.add(name);
        q = q.orderBy(sql.ref(name), desc ? 'desc' : 'asc');
    }
    return q;
}
