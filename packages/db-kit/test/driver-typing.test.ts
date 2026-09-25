import { describe, test, expect } from 'bun:test';
import { DbDriver, type IskraDrizzleDb } from '../src/driver';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

/**
 * Type-level tests proving an opt-in schema flows through DbDriver<TSchema> so
 * callers get typed Drizzle relational queries. These assertions are checked by
 * `tsc` (root typecheck) — the runtime `expect` only keeps Bun's test runner
 * happy. The default (no type argument) must keep compiling unchanged, which is
 * exercised by every other test that does `new DbDriver()`.
 *
 * `db` is a union across dialects, so we narrow to one concrete member
 * (postgres-js) before inspecting `query` — `keyof` over the raw union collapses
 * to `string | number | symbol`. On the narrowed member, the schema's tables
 * appear as query keys; the default `Record<string, never>` yields Drizzle's
 * `$drizzleTypeError` marker, i.e. exactly today's untyped (no-relations)
 * behavior.
 */

// Only its type is used: these tests check what the schema type infers.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const users = sqliteTable('users', {
    id: integer('id').primaryKey(),
    name: text('name').notNull(),
});

type Schema = { users: typeof users };

type Expect<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

// Narrow the dialect union to its postgres-js member for inspection.
type PgMember<TS extends Record<string, unknown>> = Extract<IskraDrizzleDb<TS>, PostgresJsDatabase<TS>>;

describe('DbDriver typing', () => {
    test('a typed schema flows through to driver.db.query', () => {
        // `db` is declared `IskraDrizzleDb<TSchema> | undefined` (it is only
        // assigned in start()), so strip the not-yet-started `undefined` before
        // asserting the schema-flow type.
        type Db = NonNullable<DbDriver<Schema>['db']>;
        // The instantiated db is the same union IskraDrizzleDb<Schema> exposes.
        type _dbIsUnion = Expect<Equal<Db, IskraDrizzleDb<Schema>>>;
        const _assertUnion: _dbIsUnion = true;

        // The schema's table is a typed relational query key on the narrowed member.
        type TypedKeys = keyof PgMember<Schema>['query'];
        type _hasUsers = Expect<Equal<TypedKeys, 'users'>>;
        const _assertUsers: _hasUsers = true;

        expect(_assertUnion && _assertUsers).toBe(true);
    });

    test('default DbDriver reproduces the historical untyped (no relations) behavior', () => {
        type Db = NonNullable<DbDriver['db']>;
        type _defaultUnion = Expect<Equal<Db, IskraDrizzleDb<Record<string, never>>>>;
        const _assertDefault: _defaultUnion = true;

        // Empty schema → Drizzle's no-schema marker, never a real table key.
        type DefaultKeys = keyof PgMember<Record<string, never>>['query'];
        type _noTables = Expect<Equal<DefaultKeys, '$drizzleTypeError'>>;
        const _assertNoTables: _noTables = true;

        expect(_assertDefault && _assertNoTables).toBe(true);
    });
});
