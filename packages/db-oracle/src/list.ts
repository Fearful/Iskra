import { QueryInputError } from './errors';
import { pageParams } from './pagination';
import { decodeRows, type RowsOption } from './rows';

/** A statement to list: its SQL and params by name. */
export interface ListQuery {
    sql: string;
    params?: Readonly<Record<string, unknown>>;
}

/** Runs a statement, how the driver or a transaction does. */
export type ListRunner = (sql: string, params: Readonly<Record<string, unknown>>) => Promise<Record<string, unknown>[]>;

export interface ListOptions<T = Record<string, unknown>, F = unknown, O = unknown> {
    /** The rows to list: a SELECT with its params by name (with its ORDER BY)… */
    sql?: string;
    params?: Readonly<Record<string, unknown>>;
    /**
     * …or a function that builds it from filters and orders (the rows' query
     * gets the orders; the counts get `null`, so they need no ORDER BY).
     */
    query?: (filters: F, orders: O | null) => ListQuery;
    filters?: F;
    orders?: O;
    /**
     * With `query`: the filters `total` counts with (the ones that always
     * apply, such as the user's own records), so `filtered` counts the
     * request's filters and `total` the rows before them, as DataTables'
     * recordsTotal/recordsFiltered. Without it `total` equals `filtered`.
     */
    totalFilters?: F;
    /** Rows to skip and to return (DataTables' start and length); `limit` null or -1 returns them all. */
    offset?: number | string | null;
    limit?: number | string | null;
    /** Or a 1-based page and its size (see `pageParams`); strings from a query string work. */
    page?: number | string | null;
    pageSize?: number | string | null;
    /** The most rows a request may ask for (a page size or `limit`, "all" included). */
    maxLimit?: number;
    /** `'wrap'` (default) counts with `SELECT COUNT(*) FROM (…)`; `'none'` does not count. */
    count?: 'wrap' | 'none';
    /** How each row is decoded: a `rowSpec()` or a Standard Schema. */
    rows?: RowsOption<T>;
}

export interface ListResult<T> {
    rows: T[];
    /** Rows before the request's filters (`totalFilters`), or `filtered`. */
    total?: number;
    /** Rows that match the filters. */
    filtered?: number;
    offset: number | null;
    limit: number | null;
    page?: number;
    pageSize?: number;
    /** Pages of `limit` rows (1 when not paginated). */
    pages?: number;
}

/** An integer from a number or a request's string, or a QueryInputError. */
function integer(value: number | string, name: string): number {
    const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof n !== 'number' || !Number.isInteger(n)) throw new QueryInputError(`${name} must be an integer`);
    return n;
}

function window(
    options: ListOptions<unknown, unknown, unknown>,
): Pick<ListResult<unknown>, 'offset' | 'limit' | 'page' | 'pageSize'> {
    const max = options.maxLimit;
    if (options.page != null || options.pageSize != null) {
        const p = pageParams({
            page: options.page ?? undefined,
            pageSize: options.pageSize ?? undefined,
            ...(max ? { maxPageSize: max } : {}),
        });
        return { offset: (p.page - 1) * p.pageSize, limit: p.pageSize, page: p.page, pageSize: p.pageSize };
    }
    let limit = options.limit == null ? null : integer(options.limit, 'limit');
    if (limit !== null && limit < 0) limit = null; // DataTables' -1: every row
    if (limit === 0) throw new QueryInputError('limit must be at least 1');
    if (max !== undefined && (limit === null || limit > max)) limit = max;
    const offset = limit === null ? null : options.offset == null ? 0 : integer(options.offset, 'offset');
    if (offset !== null && offset < 0) throw new QueryInputError('offset cannot be negative');
    return { offset, limit };
}

/** The rows of a page, the counts and the page window: `oracle.list()`. */
export async function listRows<T, F, O>(run: ListRunner, options: ListOptions<T, F, O>): Promise<ListResult<T>> {
    if (!options.query === !options.sql) throw new TypeError('list() takes either `sql` or `query`');
    const build = (orders: O | null, filters = options.filters as F): ListQuery =>
        options.query ? options.query(filters, orders) : { sql: options.sql!, params: options.params };
    const { offset, limit, page, pageSize } = window(options as ListOptions<unknown, unknown, unknown>);

    const listed = build(options.orders ?? null);
    const rowsSql =
        limit === null ? listed.sql : `${listed.sql}\nOFFSET :iskra_offset ROWS FETCH NEXT :iskra_limit ROWS ONLY`;
    const rowsParams =
        limit === null ? { ...listed.params } : { ...listed.params, iskra_offset: offset, iskra_limit: limit };
    const count = async (q: ListQuery) => {
        const rows = await run(`SELECT COUNT(*) AS "ISKRA_TOTAL" FROM (\n${q.sql}\n) iskra_count`, { ...q.params });
        return Number(rows[0]?.ISKRA_TOTAL ?? 0);
    };
    const counting = options.count !== 'none';
    const [raw, filtered, total] = await Promise.all([
        run(rowsSql, rowsParams),
        counting ? count(build(null)) : undefined,
        counting && options.query && options.totalFilters !== undefined
            ? count(build(null, options.totalFilters))
            : undefined,
    ]);
    const rows = options.rows ? await decodeRows(raw, options.rows) : (raw as T[]);
    return {
        rows,
        ...(filtered !== undefined ? { total: total ?? filtered, filtered } : {}),
        offset,
        limit,
        ...(page !== undefined ? { page, pageSize } : {}),
        ...(filtered !== undefined ? { pages: limit ? Math.max(1, Math.ceil(filtered / limit)) : 1 } : {}),
    };
}
