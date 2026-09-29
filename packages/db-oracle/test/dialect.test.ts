import { describe, expect, test } from 'bun:test';
import { Kysely, sql } from 'kysely';
import type { OracleCompatibility } from '../src/config';
import { OracleDialect } from '../src/dialect';

interface DB {
    USERS: { ID: number; NAME: string; ACTIVE: number };
    STAGING: { ID: number; NAME: string };
}

// Compiles only: nothing runs on these.
function kysely(compatibility: OracleCompatibility) {
    return new Kysely<DB>({
        dialect: new OracleDialect({
            acquire: () => Promise.reject(new Error('no database')),
            runner: {} as never,
            compatibility,
        }),
    });
}
const db19 = kysely('19c');
const db23 = kysely('23ai');

describe('Oracle dialect: SQL every release runs', () => {
    test('a select without FROM reads FROM DUAL', () => {
        expect(db19.selectNoFrom(sql<number>`1`.as('one')).compile().sql).toBe('select 1 "one" from "DUAL"');
        expect(
            db19
                .selectFrom('USERS')
                .select(db19.selectNoFrom(sql<Date>`sysdate`.as('now')).as('now'))
                .compile().sql,
        ).toBe('select (select sysdate "now" from "DUAL") "now" from "USERS"');
    });

    test('MERGE puts its ON condition in parentheses', () => {
        const q = db19
            .mergeInto('USERS as u')
            .using('STAGING as s', 'u.ID', 's.ID')
            .whenMatched()
            .thenUpdateSet((eb) => ({ NAME: eb.ref('s.NAME') }))
            .whenNotMatched()
            .thenInsertValues((eb) => ({ ID: eb.ref('s.ID'), NAME: eb.ref('s.NAME'), ACTIVE: 1 }))
            .compile();
        expect(q.sql).toBe(
            'merge into "USERS" "u" using "STAGING" "s" on ("u"."ID" = "s"."ID") ' +
                'when matched then update set "NAME" = "s"."NAME" ' +
                'when not matched then insert ("ID", "NAME", "ACTIVE") values ("s"."ID", "s"."NAME", :1)',
        );
    });

    test('refuses the MERGE clauses Oracle does not have', () => {
        const merge = () => db23.mergeInto('USERS as u').using('STAGING as s', 'u.ID', 's.ID');
        expect(() => merge().whenMatchedAnd('u.ACTIVE', '=', 1).thenUpdateSet({ NAME: 'x' }).compile()).toThrow(
            'no extra AND condition',
        );
        expect(() => merge().whenMatched().thenDelete().compile()).toThrow('no thenDelete() or thenDoNothing()');
        expect(() => merge().whenMatched().thenDoNothing().compile()).toThrow('no thenDelete() or thenDoNothing()');
    });

    test('refuses RETURNING and ON CONFLICT, with what to use instead', () => {
        expect(() =>
            db23.insertInto('USERS').values({ ID: 1, NAME: 'a', ACTIVE: 1 }).returning('ID').compile(),
        ).toThrow("dir: 'returning'");
        expect(() =>
            db23
                .insertInto('USERS')
                .values({ ID: 1, NAME: 'a', ACTIVE: 1 })
                .onConflict((oc) => oc.column('ID').doNothing())
                .compile(),
        ).toThrow('use mergeInto()');
    });
});

describe("Oracle dialect: compatibility '19c' refuses 23ai-only SQL", () => {
    test('booleans in SQL', () => {
        expect(() =>
            db19
                .selectFrom('USERS')
                .selectAll()
                .where('ACTIVE', '=', true as never)
                .compile(),
        ).toThrow("a boolean in SQL (Oracle 23ai only; the driver's compatibility is '19c'): use 1/0");
        expect(() => db19.selectFrom('USERS').selectAll().where(sql.lit(true)).compile()).toThrow('a boolean in SQL');
        const q = db23
            .selectFrom('USERS')
            .selectAll()
            .where('ACTIVE', '=', true as never)
            .compile();
        expect(q.parameters).toEqual([true]);
    });

    test('an INSERT of several rows with VALUES', () => {
        const rows = [
            { ID: 1, NAME: 'a', ACTIVE: 1 },
            { ID: 2, NAME: 'b', ACTIVE: 1 },
        ];
        expect(() => db19.insertInto('USERS').values(rows).compile()).toThrow('an INSERT of several rows with VALUES');
        expect(db19.insertInto('USERS').values(rows[0]!).compile().sql).toBe(
            'insert into "USERS" ("ID", "NAME", "ACTIVE") values (:1, :2, :3)',
        );
        expect(db23.insertInto('USERS').values(rows).compile().sql).toBe(
            'insert into "USERS" ("ID", "NAME", "ACTIVE") values (:1, :2, :3), (:4, :5, :6)',
        );
    });
});
