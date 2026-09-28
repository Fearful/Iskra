---
title: DB Oracle
description: Oracle Database with a node-oracledb pool in the app's process, Kysely, pagination and migrations.
---

:::caution[Experimental]
`@iskra-bun/db-oracle` is on `0.x` and may change in a minor release (see [VERSIONING.md](https://github.com/fearful/iskra/blob/main/VERSIONING.md)). Its integration suites run in CI against Oracle Database Free 23.
:::

Oracle Database for Iskra. The driver runs a [node-oracledb](https://node-oracledb.readthedocs.io) pool in **Thin mode** inside the app's Bun process: no Oracle Client libraries and no Node sidecar. On top of it:

- raw SQL with binds by name, including OUT and `RETURNING INTO` binds whose types are given by name, and `rowsAffected`;
- typed queries with [Kysely](https://kysely.dev) (`oracle.db`);
- transactions, streaming, pagination (offset and cursor), search and sorting from request parameters;
- SQL file migrations.

## Quick Start

```bash
bun add @iskra-bun/db-oracle @iskra-bun/core
```

```typescript
import { App } from '@iskra-bun/core';
import { OracleDriver } from '@iskra-bun/db-oracle';

const app = new App({
    name: 'my-app',
    oracle: {
        connectString: 'db-host:1521/FREEPDB1',
        user: process.env.ORA_USER,
        password: process.env.ORA_PASSWORD,
    },
});
const oracle = new OracleDriver<DB>(); // DB: your tables' types (see Kysely below)
app.register(oracle);

await app.start(); // fails with a ConnectionError if Oracle cannot be reached

const people = await oracle.query('SELECT id, name FROM people WHERE city = :city', { city: 'Rosario' });
const rows = await oracle.db!.selectFrom('PEOPLE').select(['ID', 'NAME']).execute();
```

Connect with a user of the app's own that has only the privileges it uses (`CREATE SESSION` and those on its tables), never `SYSTEM` or `SYS`.

## Configuration

`app.config.oracle` (typed as `OracleConfig`). Without it the driver reads `ORA_CONN`, `ORA_USER` and `ORA_PASSWORD`; with neither, it logs a warning and does not start.

| Option | Default | |
|---|---|---|
| `connectString` | — | Easy Connect (`host:1521/FREEPDB1`, `tcps://…`), a TNS alias or a full descriptor. |
| `user`, `password` | — | |
| `pool.min` / `pool.max` / `pool.increment` | 0 / 4 / 1 | Connections kept idle, open at most, and opened at a time. |
| `pool.queueTimeout` | 60000 | Milliseconds a request waits for a free connection before failing (NJS-040). |
| `pool.drainTime` | 5 | Seconds `stop()` lets connections in use finish. |
| `fetchAsString` | `[]` | `'number'` to read NUMBERs as strings (past 2^53 a JS number loses digits); `'date'` for DATE and TIMESTAMP as text. |
| `camelCase` | `false` | Kysely only: write `firstName` for the `FIRST_NAME` column, and read rows back in camelCase. |
| `poolAttributes` | `{}` | Other node-oracledb pool attributes (`walletLocation`, `configDir`…), passed as they are. |

`start()` opens the pool and runs `SELECT 1 FROM DUAL`, so a wrong password or host fails the app's start. `stop()` closes the pool. `ping()` resolves `true` or `false` (it never throws), for readiness checks.

## Raw SQL

```typescript
// The rows of a query, as objects keyed by column name (Oracle's upper case)
const rows = await oracle.query<{ ID: number; NAME: string }>('SELECT id, name FROM people WHERE id = :id', { id: 1 });

// Any statement: rows, rowsAffected and outBinds
const { rowsAffected, outBinds } = await oracle.execute(
    'INSERT INTO people (name) VALUES (:name) RETURNING id INTO :id',
    { name: 'Ana', id: { dir: 'returning', type: 'number' } },
);
outBinds.id; // number[]: one value per inserted row

// A bulk insert in one round trip
await oracle.executeMany('INSERT INTO people (name) VALUES (:name)', [{ name: 'Ana' }, { name: 'Bea' }]);
```

Binds go by name (`:id` and `{ id }`) or by position (`:1`, `:2` and an array). Outside a transaction every statement commits on its own.

### Binds with a type by name

A bind can be an object with a `type` named from this table, instead of importing node-oracledb's constants. `outBinds` is typed from those objects.

| `type` | Oracle | JS value |
|---|---|---|
| `string` | VARCHAR2 | string |
| `number` | NUMBER | number |
| `date` / `timestamp` | DATE / TIMESTAMP | Date |
| `clob` | CLOB | string |
| `blob` / `raw` | BLOB / RAW | Buffer |
| `boolean` | BOOLEAN (23ai, or PL/SQL) | boolean |

| Bind | For | `outBinds.name` |
|---|---|---|
| `{ type: 'clob', val: text }` | an IN value of that type (a long text into a CLOB) | — |
| `{ dir: 'out', type }` | a PL/SQL OUT parameter | the value, or null |
| `{ dir: 'inout', type, val }` | a PL/SQL IN OUT parameter | the value, or null |
| `{ dir: 'returning', type }` | `RETURNING … INTO :name` of an INSERT, UPDATE or DELETE | an array, one value per row |

`maxSize` sets the bytes of a `string` (default 4000) or `raw` (default 2000) out bind.

```typescript
const { outBinds } = await oracle.execute(
    'BEGIN app_pkg.register(:email, :userId, :status); END;',
    {
        email: 'ana@example.com',
        userId: { dir: 'out', type: 'number' },
        status: { dir: 'out', type: 'string', maxSize: 50 },
    },
);
outBinds.userId; // number | null
```

### LOBs, dates and numbers

CLOB columns are read as strings and BLOB columns as Buffers, whole: a node-oracledb Lob can only be read while its connection is open, and the pool takes the connection back when the statement ends. A CLOB or BLOB out bind is read the same way. For a very large LOB, read it in pieces with `DBMS_LOB.SUBSTR`.

DATE and TIMESTAMP values carry no time zone: node-oracledb writes and reads a `Date` in the process's local time, so a value round-trips unchanged. Set `TZ=UTC` for the app if other clients read the same columns.

## Kysely

`oracle.db` is a Kysely instance over the pool, typed by the `DB` type parameter. Iskra ships its own Oracle dialect for Kysely: `:1` binds, table aliases without `AS`, `offset … rows`, and `limit(n)` compiled as `fetch next n rows only`, since Oracle has no LIMIT. `sql` and Kysely's types are re-exported:

```typescript
import { OracleDriver, sql, type Generated } from '@iskra-bun/db-oracle';

interface DB {
    PEOPLE: { ID: Generated<number>; NAME: string; CITY: string | null; CREATED: Date };
}

const oracle = new OracleDriver<DB>();
// …
const db = oracle.db!;
await db.insertInto('PEOPLE').values({ NAME: 'Ana', CITY: 'Rosario', CREATED: new Date() }).execute();
const latest = await db.selectFrom('PEOPLE').selectAll().orderBy('CREATED', 'desc').limit(10).execute();
const { numUpdatedRows } = await db.updateTable('PEOPLE').set({ CITY: 'Córdoba' }).where('ID', '=', 1).executeTakeFirst();
```

Oracle stores unquoted names in upper case, so tables and columns are `PEOPLE` and `ID`. With `camelCase: true` you write `people` and `firstName` (for `FIRST_NAME`) and get rows back in camelCase; raw `query()` rows keep Oracle's names.

To generate the `DB` types from a database, use [kysely-oracledb](https://www.npmjs.com/package/kysely-oracledb)'s `generate` in a script of its own (a dev dependency); its `camelCase` option matches `camelCase: true`. It types BLOB columns as `string`: change them to `Buffer`, which is what the driver returns.

Not supported with Kysely: `returning()` (use `execute()` with `dir: 'returning'` binds), Kysely's `Migrator` (use [`runMigrations()`](#migrations)) and introspection.

## Transactions

```typescript
const orderId = await oracle.transaction(async (tx) => {
    const { outBinds } = await tx.execute(
        'INSERT INTO orders (customer_id) VALUES (:customerId) RETURNING id INTO :id',
        { customerId, id: { dir: 'returning', type: 'number' } },
    );
    await tx.db.insertInto('ORDER_LINES').values(lines.map((l) => ({ ...l, ORDER_ID: outBinds.id[0]! }))).execute();
    return outBinds.id[0];
});
```

`transaction(fn)` runs `fn` on one connection with autoCommit off: `tx.query`, `tx.execute`, `tx.executeMany` and `tx.db` (Kysely) all share it. It commits when `fn` returns and rolls back when it throws, rethrowing the error as it is (a `NotFoundError` stays a 404). Kysely's own transactions work too, with isolation levels (`read committed`, `serializable`) and savepoints:

```typescript
await oracle.db!.transaction().setIsolationLevel('serializable').execute(async (trx) => {
    // …
});
```

Oracle has no nested transactions: open one inside another and it throws.

## Pagination, search and sorting

```typescript
import { search, sortBy, QueryInputError } from '@iskra-bun/db-oracle';
import { defineRoute, ValidationError } from '@iskra-bun/web-kit';

defineRoute({
    method: 'GET',
    path: '/people',
    handler: async (ctx) => {
        const param = (name: string) => ctx.raw.req.query(name);
        try {
            let q = oracle.db!.selectFrom('PEOPLE').select(['ID', 'NAME', 'CITY']);
            q = search(q, ['NAME', 'CITY'], param('q'));
            q = sortBy(q, param('sort'), ['NAME', 'CITY']).orderBy('ID');
            return await oracle.paginate(q, { page: param('page'), pageSize: param('pageSize') });
        } catch (error) {
            if (error instanceof QueryInputError) throw new ValidationError(error.message);
            throw error;
        }
    },
});
// → { items, total, page, pageSize, pages }
```

- **`oracle.paginate(query, { page, pageSize })`** (or `paginate(db, query, options)` with a transaction's `db`) runs the page with `OFFSET … FETCH NEXT` and a count of the whole query. Page and page size may be strings from a query string; bad values fall back to the defaults, and the page size is capped at `maxPageSize` (default 100). The query needs an `orderBy` ending in a unique column: without one Oracle returns rows in no set order, and pages would repeat or skip rows.
- **`paginateByCursor(query, { keys, after, pageSize, direction })`** pages by keys (keyset pagination): a deep page costs no more than the first, and rows inserted meanwhile do not shift the pages. It orders by `keys`, which must be selected, not NULL, and together unique (end with the primary key), and returns `{ items, nextCursor }`. Pass `nextCursor` as `after` for the next page; it is null on the last one.
- **`search(query, columns, term)`** keeps the rows where any of `columns` contains `term`, ignoring case (`upper(col) like :term escape '\'`). The term is a bind, and its `%` and `_` match themselves. An empty term leaves the query as it is.
- **`sortBy(query, sort, allowed)`** orders by a parameter such as `name,-created` (`-` for descending), accepting only the fields in `allowed`. Add a unique column after it to break ties.

A malformed cursor or a field outside `allowed` throws a `QueryInputError` (code `VALIDATION_ERROR`). It comes from the client, so answer 400, as above.

## Streaming

For exports and other large results, read the rows as they arrive instead of all at once:

```typescript
for await (const row of oracle.stream('SELECT * FROM audit_log ORDER BY id', [], { chunkSize: 500 })) {
    write(row);
}
for await (const row of oracle.db!.selectFrom('AUDIT_LOG').selectAll().stream(500)) {
    write(row);
}
```

The connection is held until the loop ends (or breaks).

## Migrations

```typescript
await app.start();
const applied = await oracle.runMigrations('./migrations'); // ['001_people.sql', …]
```

`runMigrations(dir)` applies the `.sql` files of `dir` that are not yet recorded, in name order (numbers compare as numbers: `2_…` before `10_…`). A file holds statements SQL*Plus style: a SQL statement ends with `;`, and a PL/SQL block (`BEGIN`, `DECLARE`, `CREATE PROCEDURE`/`FUNCTION`/`PACKAGE`/`TRIGGER`/`TYPE`) ends with a line holding only `/`.

```sql
-- migrations/001_people.sql
CREATE TABLE people (
    id      NUMBER GENERATED BY DEFAULT ON NULL AS IDENTITY PRIMARY KEY,
    name    VARCHAR2(100) NOT NULL,
    created TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
);
CREATE INDEX people_name ON people (name);

CREATE OR REPLACE TRIGGER people_name_trim
BEFORE INSERT ON people FOR EACH ROW
BEGIN
    :NEW.name := TRIM(:NEW.name);
END;
/
```

- The applied files are recorded in `ISKRA_MIGRATIONS` (`{ table }` to choose another name) with a checksum: a file changed after it was applied is refused.
- Runners are serialized with a lock on `ISKRA_MIGRATIONS_LOCK`: several instances starting at once apply each file once. Another runner waits up to `lockTimeout` seconds (default 60).
- A file's statements and its record commit together, but **Oracle commits every DDL statement on its own**: a file that fails halfway keeps the DDL before the failure, and its DML since the last DDL is rolled back. Keep DDL and data changes in separate files, and write DDL that can run again (or fix it by hand) when a file fails.

## Readiness and observability

```typescript
import { HealthCheckFeature } from '@iskra-bun/web-kit';

const health = new HealthCheckFeature();
health.addReadinessCheck('oracle', () => oracle.ping());

// Every statement (raw and Kysely) and its binds; a throwing callback is ignored
oracle.setOnQuery((sql, binds) => app.logger.debug({ sql }, 'oracle query'));
```

Binds may hold personal data: log them only where that is acceptable.

## Errors

| Error | When |
|---|---|
| `ConnectionError` | `start()` could not open the pool or reach the database. Its message has Oracle's (`ORA-01017: …`); its context has the connect string and user, never the password. |
| `QueryError` | A statement failed. `error.errorNum` is the ORA number (`1` for ORA-00001, a unique constraint: answer 409) and `context.oracleCode` the code; the original error is `cause`. |
| `MigrationError` | A migration failed (its context names the file and statement), changed after it was applied, or the lock timed out. |
| `QueryInputError` | A pagination cursor or sort field from the request is not valid: a 400. |
| `ConfigError` (core) | `app.config.oracle` is not valid. |

## Upgrading from 0.1

0.1 ran queries through a Node process (`bridge/runner.js`).

- The bridge is gone: `node` is no longer needed, and `oracledb` is a dependency of the package (no separate install).
- `new OracleDriver()` takes no arguments: the bridge path and timeouts are gone (use `pool.queueTimeout`). The connection comes from `app.config.oracle`, or still from `ORA_CONN`, `ORA_USER` and `ORA_PASSWORD`.
- `query(sql, params)` still returns the rows, and a statement still commits on its own; for statements that commit or roll back together, use `transaction()`.
- The driver's `name` is `'OracleDriver'` (it was `'db'`, the same as db-kit's `DbDriver`).
- Errors are `QueryError`s with the ORA number instead of plain `Error`s.
