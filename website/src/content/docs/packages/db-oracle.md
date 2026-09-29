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
| `host`, `port`, `serviceName` | —, 1521, — | Instead of `connectString`: they build `host:port/serviceName` (see config-kit's [`fromEnv`](/packages/config-kit/#fromenv-a-kits-section-from-your-variable-names) to read them from your variables). |
| `user`, `password` | — | |
| `pool.min` / `pool.max` / `pool.increment` | 0 / 4 / 1 | Connections kept idle, open at most, and opened at a time. |
| `pool.queueTimeout` | 60000 | Milliseconds a request waits for a free connection before failing (NJS-040). |
| `pool.drainTime` | 5 | Seconds `stop()` lets connections in use finish. |
| `fetchAsString` | `[]` | `'number'` to read NUMBERs as strings (past 2^53 a JS number loses digits); `'date'` for DATE and TIMESTAMP as text. |
| `camelCase` | `false` | Kysely only: write `firstName` for the `FIRST_NAME` column, and read rows back in camelCase. |
| `poolAttributes` | `{}` | Other node-oracledb pool attributes (`walletLocation`, `configDir`…), passed as they are. |
| `callTimeout` | 30000 | Milliseconds a statement may run before it is cancelled (see [Timeouts](#timeouts-and-cancellation)); 0 for no limit. |
| `deadlineGrace` | the timeout, at most 5000 | Milliseconds the driver waits past a call's timeout for node-oracledb to cancel it before it gives up on the connection itself (see [Timeouts](#timeouts-and-cancellation)). |
| `pingTimeout` | 5000 | Milliseconds `ping()` waits before answering `false`. |
| `dropUnusedBinds` | `false` | Leave out the binds by name that the SQL does not use, instead of failing. |
| `bindStyle` | `'named'` | `'positional'` compiles binds by name to binds by position (see [Binds by position](#binds-by-position-bindstyle)). |
| `bindDialect` | `'oracle'` | How `'positional'` reads `:name`: `'oracle'`, or `'sqlx'` for SQL copied from Go. |
| `compatibility` | `'19c'` | The oldest database the Kysely SQL must run on: `'19c'` refuses what only 23ai understands (see [Kysely](#kysely)); `'23ai'` allows it. |

`start()` opens the pool and runs `SELECT 1 FROM DUAL`, so a wrong password or host fails the app's start; `oracle.serverVersion` then holds the database's major version (19, 21, 23…). `stop()` closes the pool. `ping()` resolves `true` or `false` within `pingTimeout` (it never throws), for readiness checks: with every connection busy it answers `false` in time instead of waiting for one, and a connection still running the ping after `pingTimeout` is dropped.

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

// The first row only (it fetches just that one), or undefined
const person = await oracle.queryOne<{ NAME: string }>('SELECT name FROM people WHERE id = :id', { id: 1 });

// A bulk insert in one round trip
await oracle.executeMany('INSERT INTO people (name) VALUES (:name)', [{ name: 'Ana' }, { name: 'Bea' }]);
```

Every statement takes options as its last argument: `{ timeout, signal, dropUnusedBinds, bindStyle, bindDialect }` (see [Timeouts](#timeouts-and-cancellation)). Outside a transaction every statement commits on its own.

Binds go by name (`:id` and `{ id }`) or by position (`:1`, `:2` and an array). **Binds by position follow the order in which their placeholders appear in the SQL, not their numbers**: in `WHERE b = :2 AND a = :1`, the first value goes to `:2`. Prefer binds by name.

A bind name that is an Oracle reserved word (`uid`, `date`, `user`, `level`, `size`…) fails with ORA-01745, and Oracle ignores the case of bind names, so `{ id, ID }` is ambiguous: the driver refuses both before sending the statement. A bind the SQL does not use fails (NJS-097/NJS-098); with `dropUnusedBinds` (the option, or the config) it is left out instead, which helps when one object of binds serves several statements.

### Binds by position (`bindStyle`)

With `bindStyle: 'positional'` (in the config, or per statement) the driver compiles binds by name to binds by position before the statement runs, so Oracle never sees a bind name: a param the SQL does not use is left out, a reserved word (`:date`, `:user`) and a name in another case (`:ID` for `{ id }`) just work, and an array expands to an IN list. The OnQuery hook still gets the SQL as written, and OUT binds come back by name.

```typescript
const oracle = new OracleDriver(); // app.config.oracle = { …, bindStyle: 'positional' }

await oracle.query('SELECT * FROM pedidos WHERE id IN (:ids) AND fecha >= :date', { ids: [1, 2, 3], date, unused: 1 });
// runs: SELECT * FROM pedidos WHERE id IN (:1, :2, :3) AND fecha >= :4
```

`bindDialect: 'sqlx'` reads the placeholders as Go's sqlx does, for SQL copied from a Go service: `::` is a literal colon (`TO_CHAR(f, 'HH24::MI')`), names match exactly, and its quirks are kept (a `?` is rebound even inside a string literal). `compileNamed(sql, params, dialect)` does the same on its own.

### One row, pages and typed rows

```typescript
import { col, rowSpec } from '@iskra-bun/db-oracle';

// A row spec: each field and its column type; `idArea` reads ID_AREA.
const Usuario = rowSpec({
    id: col.int(),
    nombre: col.string(),
    activo: col.boolean(), // 'S'/'N', 1/0, 'Y'/'N' (a CHAR(1))
    idArea: col.int(),
    baja: col.date().nullable(),
});

const usuario = await oracle.one('SELECT * FROM usuarios WHERE id = :id', { id }, { rows: Usuario });
// NoRowsError (NOT_FOUND: a 404 in web-kit) when there is none

const page = await oracle.list({
    // A function of the filters and orders; the counts get orders = null.
    query: (filters, orders) => usuariosQuery(filters, orders), // { sql, params }
    filters: { area: 3 },
    orders: 'nombre',
    totalFilters: {}, // total counts without the request's filters
    offset: c.req.query('start'), // DataTables' start and length; or page/pageSize
    limit: c.req.query('length'),
    rows: Usuario,
});
// { rows, total, filtered, offset, limit, pages }
```

- `oracle.list()` takes a `query` function (called with the orders for the rows and with `null` for the counts) or plain `sql` and `params`. It adds `OFFSET … FETCH NEXT` to the page's query and counts with `SELECT COUNT(*) FROM (…)`; `count: 'none'` skips the counts. `limit` -1 or null returns every row (up to `maxLimit`, when set); a bad `offset` or `limit` from the request is a `QueryInputError` (400). Its result goes to web-kit's `list(c, page)` as it is.
- A row spec converts each column: `col.int()` (an integer within 2^53, `col.bigint()` past it), `col.number()`, `col.string()` (a NUMBER as plain decimal text, a DATE as ISO 8601), `col.boolean()`, `col.date()`; `.nullable()` accepts NULL, `.from('COLUMN')` names another column. NULL in a field that is not nullable, or a value that does not convert, is a `RowDecodeError` that names the column but not the value. `rowSpec(spec, { extra: 'ignore' | 'keep' | 'error', missing: 'undefined' | 'zero' | 'error' })` decides about columns the spec does not name and fields whose column is missing (`'error'` and `'zero'` as Go's sqlx). `rows` also takes a Standard Schema (Zod 3.24+).
- With `fetchAsString: ['number']` NUMBERs arrive as text, exact past 2^53, and `col.bigint()` keeps them so.
- `query()`, `queryOne()`, `one()` and `list()` take `rows`. The driver and a transaction share one interface, `OracleSession`, for repositories that take either (and a test fake).

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

### Bulk inserts with types

`executeMany()` takes typed values too, for instance to load CLOBs past 32 KB, and `RETURNING INTO` binds in `bindDefs`:

```typescript
const { rowsAffected, outBinds } = await oracle.executeMany(
    'INSERT INTO docs (name, body) VALUES (:name, :body) RETURNING id INTO :id',
    docs.map((d) => ({ name: d.name, body: { type: 'clob', val: d.text } })),
    { bindDefs: { id: { dir: 'returning', type: 'number' } } },
);
outBinds; // [{ id: [41] }, { id: [42] }, …]: one per row
```

Once a type is named, node-oracledb needs a definition for every bind: the others are inferred from the rows, and strings and RAW get the size of the longest value.

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

The dialect writes SQL that runs on every release, and refuses at compile time, with what to use instead, what Oracle does not have:

- A select without FROM (`selectNoFrom`) reads `FROM DUAL`, required before 23ai.
- A `mergeInto()` puts its `ON` condition in parentheses, as Oracle requires. Oracle's MERGE takes `whenMatched().thenUpdateSet()` and `whenNotMatched().thenInsertValues()` only: `whenMatchedAnd()`, `thenDelete()` and `thenDoNothing()` are refused.
- With `compatibility: '19c'` (the default), a boolean value in SQL and an INSERT of several rows with VALUES are refused: both exist from 23ai only. Use 1/0 or 'Y'/'N', and `executeMany()` or one insert per row. With `'23ai'` they are allowed (the driver warns if the database is older).
- `returning()` (use `execute()` with `dir: 'returning'` binds), `onConflict()` and `onDuplicateKeyUpdate()` (use `mergeInto()`), and `limit()` on an UPDATE or DELETE.

Not supported with Kysely either: Kysely's `Migrator` (use [`runMigrations()`](#migrations)) and introspection.

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

Inside `transaction(fn)`, `oracle.query()`, `oracle.execute()`, `oracle.db` and the rest run in the transaction too, on its connection: another connection touching the rows the transaction locked would wait for them forever, a lock Oracle does not detect as a deadlock. Oracle has no nested transactions: `transaction()` inside another throws. Inside Kysely's `oracle.db.transaction()`, use its `trx`: `oracle.*` does not join it.

## Pagination, search and sorting

```typescript
import { search, sortBy } from '@iskra-bun/db-oracle';
import { defineRoute } from '@iskra-bun/web-kit';

defineRoute({
    method: 'GET',
    path: '/people',
    handler: async (ctx) => {
        const param = (name: string) => ctx.raw.req.query(name);
        let q = oracle.db!.selectFrom('PEOPLE').select(['ID', 'NAME', 'CITY']);
        q = search(q, ['NAME', 'CITY'], param('q'));
        q = sortBy(q, param('sort'), ['NAME', 'CITY']).orderBy('ID');
        return oracle.paginate(q, { page: param('page'), pageSize: param('pageSize') });
    },
});
// → { items, total, page, pageSize, pages }
```

- **`oracle.paginate(query, { page, pageSize })`** (or `paginate(db, query, options)` with a transaction's `db`) runs the page with `OFFSET … FETCH NEXT` and a count of the whole query. Page and page size may be strings from a query string; bad values fall back to the defaults, and the page size is capped at `maxPageSize` (default 100). The query needs an `orderBy` ending in a unique column: without one Oracle returns rows in no set order, and pages would repeat or skip rows.
- **`paginateByCursor(query, { keys, after, pageSize, direction })`** pages by keys (keyset pagination): a deep page costs no more than the first, and rows inserted meanwhile do not shift the pages. It orders by `keys`, which must be selected, not NULL, and together unique (end with the primary key), and returns `{ items, nextCursor }`. Pass `nextCursor` as `after` for the next page; it is null on the last one. Declare a DATE or TIMESTAMP key as `{ key: 'CREATED', type: 'timestamp' }`: the cursor then carries its text with all nine fractional digits, since a JS Date keeps milliseconds and a TIMESTAMP(6) microseconds, and rows would repeat or be skipped. A date key not declared that way throws.
- **`search(query, columns, term)`** keeps the rows where any of `columns` contains `term`, ignoring case (`upper(col) like :term escape '\'`). The term is a bind, and its `%` and `_` match themselves. An empty term leaves the query as it is.
- **`sortBy(query, sort, allowed)`** orders by a parameter such as `name,-created` (`-` for descending), accepting only the fields in `allowed`. Add a unique column after it to break ties.

A malformed cursor or a field outside `allowed` throws a `QueryInputError` (code `VALIDATION_ERROR`). It comes from the client: web-kit answers it 400 with its message (it is marked `expose`); elsewhere, answer 400 yourself.

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
- PL/SQL that does not compile is still created, invalid: node-oracledb reports it as a warning (NJS-700), not an error. `runMigrations()` fails the file on it, with the errors of `USER_ERRORS` (`PROCEDURE P (line 3, column 5: PLS-00201: …)`), and does not record it.
- A file's statements and its record commit together, but **Oracle commits every DDL statement on its own**: a file that fails halfway keeps the DDL before the failure, and its DML since the last DDL is rolled back. Keep DDL and data changes in separate files, and write DDL that can run again (or fix it by hand) when a file fails.

## Timeouts and cancellation

Every statement runs with `callTimeout` (30 s by default): past it, node-oracledb cancels the statement on the database and it fails with a `QueryError` NJS-123, or, when the database does not take that cancel, the driver gives up on it at its [deadline](#the-deadline); either way its connection is dropped from the pool. A statement waiting on a row lock would otherwise never end and hold its connection; with the default pool of 4, a few of them stop the whole service. Set the limit per statement, or cancel with an `AbortSignal` (the statement fails with ORA-01013):

```typescript
await oracle.execute('UPDATE accounts SET balance = :b WHERE id = :id', binds, { timeout: 2000 });

const controller = new AbortController();
setTimeout(() => controller.abort(), 1000);
await oracle.query(reportSql, [], { signal: controller.signal, timeout: 0 });

await oracle.db!.selectFrom('PEOPLE').selectAll().execute({ signal: controller.signal });
```

`timeout: 0` lifts the limit (a report, an export). Migrations run without it: building an index may take long. A request waiting for a free connection is bounded by `pool.queueTimeout` instead (NJS-040).

### The deadline

In Thin mode node-oracledb cancels a call by sending the database a break on the same connection, and a session waiting on a row lock does not read it: `callTimeout` then never ends that wait, nor does an `AbortSignal`, and the call and its connection stay taken for good. So the driver does not rely on it alone. Each call (a statement, each fetch of a stream, a commit or a rollback) has a **deadline**: its timeout plus `deadlineGrace` (by default the timeout itself, at most 5 s: a 30 s timeout gives up at 35 s, a 1 s one at 2 s). Past it:

- the call fails with a `DeadlineError` (a `QueryError` with `deadlineMs`);
- the driver closes the connection's socket, so node-oracledb lets go of it and it leaves the pool at once (with node-oracledb versions or modes where it cannot, it asks node-oracledb to cancel and drops the connection when the call ends);
- in a transaction, the transaction is lost: the next statements and the commit fail without running, and `transaction()` rethrows.

An abort works the same way: if the statement has not stopped `deadlineGrace` (1 s by default) after the signal, the driver gives up on its connection and the statement fails with ORA-01013.

:::caution
Giving up does not stop the database. A session waiting on a lock keeps waiting after its socket closes, and runs the statement once the lock frees: outside a transaction, where each statement commits on its own, **the statement may still take effect**. In a transaction it cannot: the session dies when it tries to answer, and the database rolls the transaction back. Run inside `transaction()` what must not apply late.
:::

A call without a timeout (`timeout: 0`, migrations) has no deadline. `error.timedOut` is `true` for both NJS-123 and a `DeadlineError`. The deadline counts the whole call, so a query that fetches many rows in many round trips needs a `timeout` that covers all of it. Statements of one transaction run one at a time (node-oracledb would queue them anyway), each with its own timeout.

## Readiness and observability

```typescript
import { HealthCheckFeature } from '@iskra-bun/web-kit';

const health = new HealthCheckFeature();
health.addReadinessCheck('oracle', () => oracle.ping());

// Every statement (raw and Kysely) and its binds; a throwing callback is ignored
oracle.setOnQuery((sql, binds) => app.logger.debug({ sql }, 'oracle query'));
```

The callback may return a function, called when the statement ends with `{ durationMs, rows, rowsAffected, error }`: the end of a trace span. A stream calls it once, with all the rows it yielded; commits and rollbacks call it too (`COMMIT`, `ROLLBACK`). `setOnQuery()` holds one callback; `oracle.onQuery(callback)` adds one more (a tracer and a logger each keep their own) and returns what removes it.

`instrumentOracle(oracle)` does the tracing: a CLIENT span per statement, commit and rollback (`oracle SELECT`), the child of the span active when it ran (such as core's `traced()`), with `db.system.name`, `db.operation.name`, `db.query.text` (the SQL as written, never the bind values; `queryText: false` leaves it out) and `db.response.returned_rows`; a failure records its error code.

```typescript
import { instrumentOracle } from '@iskra-bun/db-oracle';

instrumentOracle(oracle); // the global tracer provider's, or { tracer }
```

Binds may hold personal data: log them only where that is acceptable.

## Errors

| Error | When |
|---|---|
| `ConnectionError` | `start()` could not open the pool or reach the database. Its message has Oracle's (`ORA-01017: …`); its context has the connect string and user, never the password. |
| `QueryError` | A statement failed. `error.errorCode` is the database's or the driver's code, and `error.errorNum` the ORA number; the original error is `cause`. Its `code` tells web-kit how to answer: `CONFLICT` (409) for `ORA-00001` (a unique constraint), `SERVICE_UNAVAILABLE` (503) for `NJS-040` (no free connection within `pool.queueTimeout`), `TIMEOUT` (504) for `NJS-123` (`callTimeout` exceeded), `QUERY_ERROR` (500) otherwise; the message stays in the log. `error.timedOut` is `true` for NJS-123 and a `DeadlineError`. A PL/SQL `RAISE_APPLICATION_ERROR` (ORA-20000 to ORA-20999) is a `CONFLICT` (409) whose message is the procedure's, without `ORA-20xxx:` and the stack, and is shown to the client; `error.applicationError` has its number and message. |
| `DeadlineError` | A `QueryError`: a call ran past its [deadline](#the-deadline) and the driver gave up on its connection. `error.deadlineMs` is the deadline; its code is `TIMEOUT` (504). |
| `MigrationError` | A migration failed (its context names the file and statement), changed after it was applied, or the lock timed out. |
| `QueryInputError` | A pagination cursor, sort field, `offset` or `limit` from the request is not valid: web-kit answers 400 with its message. |
| `NoRowsError` | `one()` found no row: a `QueryError` with code `NOT_FOUND` (404). |
| `RowDecodeError` | A row does not fit its row spec or schema: a `QueryError` (500) that names the column, not the value. |
| `ConfigError` (core) | `app.config.oracle` is not valid. |

## Upgrading from 0.1

0.1 ran queries through a Node process (`bridge/runner.js`).

- The bridge is gone: `node` is no longer needed, and `oracledb` is a dependency of the package (no separate install).
- `new OracleDriver()` takes no arguments: the bridge path and timeouts are gone (use `pool.queueTimeout`). The connection comes from `app.config.oracle`, or still from `ORA_CONN`, `ORA_USER` and `ORA_PASSWORD`.
- `query(sql, params)` still returns the rows, and a statement still commits on its own; for statements that commit or roll back together, use `transaction()`.
- The driver's `name` is `'OracleDriver'` (it was `'db'`, the same as db-kit's `DbDriver`).
- Errors are `QueryError`s with the ORA number instead of plain `Error`s.
