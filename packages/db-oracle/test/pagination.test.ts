import { describe, expect, test } from 'bun:test';
import { CamelCasePlugin, Kysely } from 'kysely';
import { OracleDialect } from '../src/dialect';
import { QueryInputError } from '../src/errors';
import {
    decodeCursor,
    encodeCursor,
    escapeLike,
    pageParams,
    paginateByCursor,
    search,
    sortBy,
} from '../src/pagination';
import { startedDriver } from './fakes';

interface DB {
    USERS: { ID: number; NAME: string; CREATED: Date };
}

// Compiles only: nothing runs on this one.
const db = new Kysely<DB>({
    dialect: new OracleDialect({
        acquire: () => Promise.reject(new Error('no database')),
        runner: {} as never,
        compatibility: '19c',
    }),
});
const users = () => db.selectFrom('USERS').select(['ID', 'NAME']);

describe('Oracle SQL', () => {
    test('binds as :1, :2…, table aliases without AS', () => {
        const q = db.selectFrom('USERS as u').select('u.ID').where('u.NAME', '=', 'Ana').compile();
        expect(q.sql).toBe('select "u"."ID" from "USERS" "u" where "u"."NAME" = :1');
    });

    test('limit() becomes FETCH NEXT, after OFFSET … ROWS', () => {
        expect(users().orderBy('ID').limit(10).compile().sql).toBe(
            'select "ID", "NAME" from "USERS" order by "ID" fetch next :1 rows only',
        );
        const q = users().orderBy('ID').limit(10).offset(20).compile();
        expect(q.sql).toBe('select "ID", "NAME" from "USERS" order by "ID" offset :1 rows fetch next :2 rows only');
        expect(q.parameters).toEqual([20, 10]);
    });

    test('a subquery keeps its limit as a fetch', () => {
        const q = db
            .selectFrom('USERS')
            .select('ID')
            .where('ID', 'in', db.selectFrom('USERS').select('ID').orderBy('CREATED', 'desc').limit(5))
            .compile();
        expect(q.sql).toContain('order by "CREATED" desc fetch next :1 rows only)');
    });

    test('limit() and fetch() together, or a limit on UPDATE, are refused', () => {
        expect(() => users().limit(1).fetch(2).compile()).toThrow('limit() or fetch()');
        expect(() =>
            db
                .updateTable('USERS')
                .set({ NAME: 'x' })
                .limit(1 as never)
                .compile(),
        ).toThrow('Oracle has no LIMIT');
    });
});

describe('pageParams', () => {
    test.each([
        [{}, { page: 1, pageSize: 20 }],
        [
            { page: '3', pageSize: '50' },
            { page: 3, pageSize: 50 },
        ],
        [
            { page: 0, pageSize: 1000 },
            { page: 1, pageSize: 100 },
        ],
        [
            { page: 'abc', pageSize: '' },
            { page: 1, pageSize: 20 },
        ],
        [
            { page: 2.7, pageSize: -5 },
            { page: 2, pageSize: 1 },
        ],
        [
            { pageSize: 30, maxPageSize: 25, defaultPageSize: 10 },
            { page: 1, pageSize: 25 },
        ],
        [{ page: '1e20' }, { page: 1_000_000_000, pageSize: 20 }],
    ])('%j → %j', (options, expected) => {
        expect(pageParams(options)).toEqual(expected);
    });
});

describe('cursors', () => {
    test('round-trip strings, numbers, booleans and dates', () => {
        const values = ['Ana', 42, true, new Date('2026-01-02T03:04:05.678Z')];
        expect(decodeCursor(encodeCursor(values), 4)).toEqual(values);
    });

    test.each([
        ['not base64 json', 'garbage!!'],
        ['wrong length', encodeCursor([1, 2])],
        ['object value', Buffer.from(JSON.stringify([{ a: 1 }])).toString('base64url')],
        ['bad date', Buffer.from(JSON.stringify([{ d: 'nope' }])).toString('base64url')],
        ['too long', 'a'.repeat(5000)],
    ])('rejects a cursor: %s', (_, cursor) => {
        expect(() => decodeCursor(cursor, 1)).toThrow(QueryInputError);
    });
});

describe('search, sortBy', () => {
    test('search() matches any column ignoring case, with LIKE wildcards escaped', () => {
        const q = search(users(), ['NAME', 'ID'], ' 50%_off\\ ').compile();
        expect(q.sql).toBe(
            'select "ID", "NAME" from "USERS" where (upper("NAME") like :1 escape \'\\\' or upper("ID") like :2 escape \'\\\')',
        );
        expect(q.parameters).toEqual(['%50\\%\\_OFF\\\\%', '%50\\%\\_OFF\\\\%']);
        expect(escapeLike('a_b%c\\')).toBe('a\\_b\\%c\\\\');
    });

    test('search() with an empty term leaves the query alone', () => {
        expect(search(users(), ['NAME'], '  ').compile().sql).toBe(users().compile().sql);
        expect(search(users(), ['NAME'], undefined).compile().sql).toBe(users().compile().sql);
    });

    test('with camelCase, search() and sortBy() name the UPPER_SNAKE_CASE columns', () => {
        const cc = new Kysely<{ appUsers: { userId: number; firstName: string } }>({
            dialect: new OracleDialect({
                acquire: () => Promise.reject(new Error('no database')),
                runner: {} as never,
                compatibility: '19c',
            }),
            plugins: [new CamelCasePlugin({ upperCase: true })],
        });
        const q = sortBy(search(cc.selectFrom('appUsers').select('userId'), ['firstName'], 'ana'), '-firstName', [
            'firstName',
        ]).compile();
        expect(q.sql).toBe(
            'select "USER_ID" from "APP_USERS" where (upper("FIRST_NAME") like :1 escape \'\\\') order by "FIRST_NAME" desc',
        );
    });

    test('sortBy() orders by allowed fields and refuses others', () => {
        expect(sortBy(users(), '-NAME, ID,NAME', ['ID', 'NAME']).compile().sql).toBe(
            'select "ID", "NAME" from "USERS" order by "NAME" desc, "ID" asc',
        );
        expect(sortBy(users(), '', ['ID']).compile().sql).toBe(users().compile().sql);
        expect(() => sortBy(users(), 'PASSWORD', ['ID', 'NAME'])).toThrow(QueryInputError);
    });
});

describe('paginate, paginateByCursor', () => {
    test('paginate() runs the page and a count, and needs an orderBy', async () => {
        const { driver, pool } = await startedDriver<DB>();
        pool.respond = ({ sql }) =>
            sql.startsWith('select count(*)') ? { rows: [{ total: 45 }] } : { rows: [{ ID: 21 }, { ID: 22 }] };
        const q = driver.db!.selectFrom('USERS').select(['ID']).where('NAME', 'like', 'A%').orderBy('ID');
        const page = await driver.paginate(q, { page: 3, pageSize: 10 });
        expect(page).toEqual({ items: [{ ID: 21 }, { ID: 22 }], total: 45, page: 3, pageSize: 10, pages: 5 });
        expect(pool.statements.sort()).toEqual([
            'select "ID" from "USERS" where "NAME" like :1 order by "ID" offset :2 rows fetch next :3 rows only',
            'select count(*) as "total" from (select "ID" from "USERS" where "NAME" like :1) iskra_page',
        ]);
        await expect(driver.paginate(driver.db!.selectFrom('USERS').select('ID'))).rejects.toThrow('needs an orderBy');
        await expect(driver.paginate(q.limit(5))).rejects.toThrow('leave limit, offset and fetch out');
    });

    test('paginateByCursor() orders by its keys, fetches one extra row and continues after the cursor', async () => {
        const { driver, pool } = await startedDriver<DB>();
        pool.respond = () => ({ rows: [3, 2, 1].map((n) => ({ ID: n, NAME: `n${n}` })) });
        const q = () => driver.db!.selectFrom('USERS').select(['ID', 'NAME']);
        const first = await paginateByCursor(q(), { keys: ['ID'], direction: 'desc', pageSize: 2 });
        expect(first.items).toEqual([
            { ID: 3, NAME: 'n3' },
            { ID: 2, NAME: 'n2' },
        ]);
        expect(pool.calls.at(-1)!.sql).toBe(
            'select "ID", "NAME" from "USERS" order by "ID" desc fetch next :1 rows only',
        );
        expect(pool.calls.at(-1)!.binds).toEqual([3]);
        expect(decodeCursor(first.nextCursor!, 1)).toEqual([2]);

        pool.respond = () => ({ rows: [{ ID: 1, NAME: 'n1' }] });
        const second = await paginateByCursor(q(), {
            keys: ['ID'],
            direction: 'desc',
            pageSize: 2,
            after: first.nextCursor,
        });
        expect(second.nextCursor).toBeNull();
        expect(pool.calls.at(-1)!.sql).toBe(
            'select "ID", "NAME" from "USERS" where (("ID" < :1)) order by "ID" desc fetch next :2 rows only',
        );
        expect(pool.calls.at(-1)!.binds).toEqual([2, 3]);

        await expect(paginateByCursor(q().orderBy('ID'), { keys: ['ID'] })).rejects.toThrow('leave orderBy out');
        await expect(paginateByCursor(q(), { keys: ['ID'], after: 'bad' })).rejects.toThrow(QueryInputError);
    });

    test('paginateByCursor(): a timestamp key goes in the cursor as text with all its digits', async () => {
        const { driver, pool } = await startedDriver<DB>();
        const ts = (n: number) => `2026-01-01 00:00:00.00000${n}000`;
        pool.respond = () => ({
            rows: [3, 2, 1].map((n) => ({ ID: n, CREATED: new Date('2026-01-01T00:00:00Z'), iskracursor0: ts(n) })),
        });
        const q = () => driver.db!.selectFrom('USERS').select(['ID', 'CREATED']);
        const keys = [{ key: 'CREATED', type: 'timestamp' }, 'ID'] as const;
        const first = await paginateByCursor(q(), { keys, direction: 'desc', pageSize: 2 });
        // The hidden column is not in the items.
        expect(first.items).toEqual([3, 2].map((n) => ({ ID: n, CREATED: new Date('2026-01-01T00:00:00Z') })));
        expect(pool.calls.at(-1)!.sql).toBe(
            'select "ID", "CREATED", to_char(cast("CREATED" as timestamp(9)), \'YYYY-MM-DD HH24:MI:SS.FF9\') "iskracursor0" ' +
                'from "USERS" order by "CREATED" desc, "ID" desc fetch next :1 rows only',
        );
        expect(decodeCursor(first.nextCursor!, 2)).toEqual([{ ts: ts(2) }, 2]);

        await paginateByCursor(q(), { keys, direction: 'desc', pageSize: 2, after: first.nextCursor });
        expect(pool.calls.at(-1)!.sql).toContain(
            'where (("CREATED" < to_timestamp(:1, \'YYYY-MM-DD HH24:MI:SS.FF9\')) or ' +
                '("CREATED" = to_timestamp(:2, \'YYYY-MM-DD HH24:MI:SS.FF9\') and "ID" < :3))',
        );
        expect(pool.calls.at(-1)!.binds).toEqual([ts(2), ts(2), 2, 3]);

        // A date key that is not declared refuses to page.
        await expect(paginateByCursor(q(), { keys: ['CREATED', 'ID'], pageSize: 2 })).rejects.toThrow(
            "declare it { key: 'CREATED', type: 'timestamp' }",
        );
        // A cursor that does not match the keys is a bad request.
        await expect(paginateByCursor(q(), { keys, after: encodeCursor([5, 2]) })).rejects.toThrow(QueryInputError);
    });
});
