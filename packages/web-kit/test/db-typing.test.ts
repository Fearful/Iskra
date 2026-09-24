import { describe, test, expect } from "bun:test";
import { DbFeature, type WebKitDrizzleDb } from "../src/features/db";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

/**
 * Type-level tests proving an opt-in schema flows through DbFeature<TSchema> so
 * callers get typed Drizzle relational queries. Checked by `tsc` (root
 * typecheck); the runtime `expect` only keeps Bun's runner happy. The default
 * (no type argument) must keep compiling unchanged — exercised by every other
 * test that does `new DbFeature(...)`.
 *
 * `db` is a union across dialects, so we narrow to one concrete member
 * (postgres-js) before inspecting `query`. On the narrowed member the schema's
 * tables appear as query keys; the default `Record<string, never>` yields
 * Drizzle's `$drizzleTypeError` marker — exactly today's untyped behavior.
 */

// Only its type is used: these tests check what the schema type infers.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const users = sqliteTable("users", {
    id: integer("id").primaryKey(),
    name: text("name").notNull(),
});

type Schema = { users: typeof users };

type Expect<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type PgMember<TS extends Record<string, unknown>> = Extract<WebKitDrizzleDb<TS>, PostgresJsDatabase<TS>>;

describe("DbFeature typing", () => {
    test("a typed schema flows through to feature.db.query", () => {
        type Db = DbFeature<Schema>["db"];
        type _dbIsUnion = Expect<Equal<Db, WebKitDrizzleDb<Schema>>>;
        const _assertUnion: _dbIsUnion = true;

        type TypedKeys = keyof PgMember<Schema>["query"];
        type _hasUsers = Expect<Equal<TypedKeys, "users">>;
        const _assertUsers: _hasUsers = true;

        expect(_assertUnion && _assertUsers).toBe(true);
    });

    test("default DbFeature reproduces the historical untyped (no relations) behavior", () => {
        type Db = DbFeature["db"];
        type _defaultUnion = Expect<Equal<Db, WebKitDrizzleDb<Record<string, never>>>>;
        const _assertDefault: _defaultUnion = true;

        type DefaultKeys = keyof PgMember<Record<string, never>>["query"];
        type _noTables = Expect<Equal<DefaultKeys, "$drizzleTypeError">>;
        const _assertNoTables: _noTables = true;

        expect(_assertDefault && _assertNoTables).toBe(true);
    });

    test("WebKitDrizzleDb default is assignable to the Hono context db variable", () => {
        // The `declare module "hono"` augmentation types `db` as WebKitDrizzleDb
        // (default schema). A default-typed feature.db must remain assignable.
        const _check = (d: WebKitDrizzleDb): WebKitDrizzleDb => d;
        expect(typeof _check).toBe("function");
    });
});
