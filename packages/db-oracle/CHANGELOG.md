# @iskra-bun/db-oracle

## 0.3.0

### Minor Changes

- 6ce8c75: Each call to the database (a statement, each fetch of a stream, a commit, a rollback) now has a deadline measured by the driver: its timeout plus `deadlineGrace` (by default the timeout itself, at most 5 s). In Thin mode node-oracledb cancels a call with a break on the same connection, and a session waiting on a row lock does not read it, so `callTimeout` (and an `AbortSignal`) never ended that wait and the connection was held forever. Past the deadline the call fails with a `DeadlineError`, and the driver closes the connection's socket so it leaves the pool at once; a transaction on it is lost (later statements and the commit fail without running) and the database rolls it back. An abort not honored within `deadlineGrace` (1 s by default) gives up the same way, with ORA-01013. `QueryError.timedOut` is true for NJS-123 and a `DeadlineError`.

    - Statements of one transaction run one at a time, each with its own `callTimeout`: concurrent ones (a `paginate()` inside `transaction()`) overwrote each other's.
    - `ping()` drops a connection that answers after `pingTimeout`.
    - A statement given up outside a transaction may still run on the database once its lock frees (as it did before, when the call hung): run inside `transaction()` what must not apply late.
    - **Breaking:** the deadline counts the whole call, so a query that fetches many rows in many round trips needs a `timeout` that covers all of them.

- e86ed55: A `QueryError`'s `code` now says how to answer it over HTTP, which web-kit's response contract does on its own: `TIMEOUT` (504) for NJS-123 and a `DeadlineError`, `SERVICE_UNAVAILABLE` (503) for NJS-040 (no free connection), `CONFLICT` (409) for ORA-00001 (a unique constraint), and `QUERY_ERROR` (500) for the rest; all of them were `QUERY_ERROR`. A `QueryInputError` (a bad cursor or sort field from the request) is marked `expose`, so web-kit answers it 400 with its message instead of a 500.
- e4c6278: `fakeOracle()` in `@iskra-bun/db-oracle/testing` answers statements by SQL matchers (a string, a RegExp or a function) with rows, a result, a function or an error, records the calls with the SQL and binds as written, decodes rows by their spec, pages `list()` from the rows it answers, and counts a transaction's commits and rollbacks; `expectAllMatched()` names the rules nothing used. `OracleDatabase` (statements, `transaction()`, `ping()`) is the interface the driver and the fake share, for repositories that take either.
- e5f41e7: `app.config.oracle` takes `host`, `port` (default 1521) and `serviceName` instead of `connectString`, which they build as `host:port/serviceName`.
- 904ec94: Helpers for raw SQL resources:

    - `bindStyle: 'positional'` (config or per statement) compiles binds by name to binds by position before a statement runs, so a param the SQL does not use, a reserved word (`:date`) or a name in another case no longer fail it, and an array expands to an IN list; OUT binds come back by name. `bindDialect: 'sqlx'` reads placeholders as Go's sqlx does (`::` is a literal colon), for SQL copied from a Go service. `compileNamed(sql, params, dialect)` does it on its own.
    - `oracle.list({ query | sql, filters, orders, totalFilters, offset/limit | page/pageSize, rows })` returns a page and its counts (`{ rows, total, filtered, offset, limit, pages }`), as DataTables' recordsTotal and recordsFiltered; a bad offset or limit from the request is a `QueryInputError`.
    - `oracle.one()` returns the first row or throws a `NoRowsError` (`NOT_FOUND`, a 404 in web-kit).
    - `rowSpec({ id: col.int(), activo: col.boolean(), … })` decodes each row by column type (a `CHAR(1)` flag, a NUMBER as plain decimal text, a bigint past 2^53), with Go sqlx's rules for extra and missing columns as options; `rows` also takes a Standard Schema. `query()`, `queryOne()`, `one()` and `list()` take it.
    - A PL/SQL `RAISE_APPLICATION_ERROR` (ORA-20000 to ORA-20999) is a `CONFLICT` whose message (without `ORA-20xxx:` and the stack) is shown to the client; `QueryError.applicationError` has it.
    - `OracleSession`, the interface the driver and a transaction share; a transaction also has `one()` and `list()`.

- ae7c798: `instrumentOracle(oracle)` traces the driver: a CLIENT span per statement, commit and rollback, the child of the active span, with `db.system.name`, `db.operation.name`, `db.query.text` (the SQL as written, never the bind values) and `db.response.returned_rows`, and the error code of a failure. `oracle.onQuery(callback)` adds a hook besides `setOnQuery()`'s single one (and returns what removes it), and the hooks now see commits and rollbacks.

### Patch Changes

- Updated dependencies [e86ed55]
- Updated dependencies [ae7c798]
- Updated dependencies [ef10372]
    - @iskra-bun/core@0.3.0

## 0.2.0

### Minor Changes

- 1da1494: db-oracle hardening, from a proof of concept on Oracle 19c.

    - **Timeouts and cancellation:** every statement runs with `callTimeout` (new config, 30 s by default; 0 for no limit) and fails past it with a `QueryError` NJS-123, its connection dropped from the pool: a statement waiting on a lock held its connection forever, and a few of them stopped the pool. Statements take `{ timeout, signal }` as their last argument (an `AbortSignal` cancels a running statement, ORA-01013), Kysely queries a `signal`. `ping()` answers within `pingTimeout` (new, 5 s) even with every connection busy; it waited for `pool.queueTimeout` (60 s).
    - **Breaking:** inside `transaction(fn)`, `oracle.query()`, `oracle.execute()`, `oracle.db`… run in the transaction. They took another connection, which waited forever on the transaction's own row locks (Oracle does not see it as a deadlock). `transaction()` inside another throws.
    - The OnQuery hook may return a function, called when the statement ends with `{ durationMs, rows, rowsAffected, error }` (a stream: once, with all its rows), for tracing.
    - `QueryError` carries the driver's codes too: `error.errorCode` is `'NJS-040'` for no free connection within `pool.queueTimeout` (a 503) and `'NJS-123'` for a timeout, besides ORA codes.
    - `queryOne()` (and `tx.queryOne()`): the first row, fetching only that one.
    - Binds: a name that is an Oracle reserved word (`uid`, `date`, `user`…, ORA-01745) or that differs from another only in case is refused before the statement runs; `dropUnusedBinds` (config and per call) leaves out the binds by name the SQL does not use (NJS-097/NJS-098). `executeMany()` takes typed binds and `bindDefs` by type name (`clob` to load CLOBs in bulk, `returning` binds with one set of out binds per row). `execute()` reports node-oracledb's `warning`.
    - **Breaking (Kysely):** new `compatibility` config, `'19c'` by default: booleans in SQL and multi-row VALUES, which only 23ai understands, are refused at compile time; `'23ai'` allows them. A select without FROM reads FROM DUAL (`selectNoFrom` failed with ORA-00923 before 23ai). MERGE puts its ON condition in parentheses, which Oracle requires in every release. `whenMatchedAnd()`, `thenDelete()`, `thenDoNothing()`, `returning()`, `onConflict()` and `onDuplicateKeyUpdate()` are refused with what to use instead. `oracle.serverVersion` holds the database's major version.
    - `runMigrations()` fails a file whose PL/SQL is created with compilation errors (node-oracledb's warning NJS-700), with the errors of USER_ERRORS, instead of recording it as applied.
    - **Breaking:** `paginateByCursor()` takes a DATE or TIMESTAMP key as `{ key, type: 'timestamp' }`, carried in the cursor with all nine fractional digits: with a JS Date (milliseconds) a TIMESTAMP(6) key repeated or skipped rows. A date key not declared that way throws.
    - The `oracle` CI job runs against 21c XE as well as 23ai (21c shares 19c's limits on these constructs; there is no public 19c image).

- 3433987: **Breaking:** db-oracle runs node-oracledb in the app's process and covers what db-kit does (still experimental).

    - The Node bridge (`bridge/runner.js`) is gone: the driver opens a node-oracledb pool in Thin mode (no Oracle Client, no `node`), and `oracledb` is a dependency. `new OracleDriver()` takes no arguments (the bridge path and timeouts are gone); the connection comes from the new `app.config.oracle` (`connectString`, `user`, `password`, `pool`, `fetchAsString`, `camelCase`, `poolAttributes`) or, as before, `ORA_CONN`, `ORA_USER` and `ORA_PASSWORD`. `start()` fails with a `ConnectionError` carrying Oracle's message when the database cannot be reached. The driver's `name` is `"OracleDriver"` (it was `"db"`, the same as db-kit's `DbDriver`).
    - `execute(sql, binds)` returns `{ rows, rowsAffected, outBinds }`, and `executeMany()` runs a bulk insert in one round trip. A bind may name its type — `{ dir: 'out' | 'inout' | 'returning', type: 'number' }`, `{ type: 'clob', val }` — and `outBinds` is typed from those binds (a `returning` bind is an array, one value per row). `query()` still returns the rows. CLOBs are read as strings and BLOBs as Buffers, since a Lob cannot outlive its pooled connection; `fetchAsString: ['number']` keeps the digits of NUMBERs past 2^53.
    - `oracle.db` is Kysely, typed by `OracleDriver<DB>`, on an Oracle dialect of Iskra's own (`:1` binds, table aliases without `AS`, `limit()` compiled as `FETCH NEXT`), with optional camelCase names. `sql` and Kysely's types are re-exported.
    - `transaction(fn)` runs raw and Kysely statements on one connection and commits, or rolls back and rethrows the callback's error as it is; Kysely's transactions work too, with isolation levels and savepoints. Outside a transaction a statement commits on its own.
    - Pagination and search: `paginate()` / `oracle.paginate()` (`OFFSET … FETCH` and the total), `paginateByCursor()` (keyset, composite keys), `search()` (case-insensitive `LIKE` across columns, the term's `%` and `_` matching themselves) and `sortBy()` (a request's sort fields, from an allowlist). A bad cursor or sort field throws a `QueryInputError` (`VALIDATION_ERROR`), for a 400.
    - `stream()` and Kysely's `.stream()` read large results in chunks. `runMigrations(dir)` applies SQL\*Plus-style `.sql` files once each, recorded with a checksum in `ISKRA_MIGRATIONS` and serialized across instances by a table lock. `ping()` and `setOnQuery()` work as in db-kit.
    - Errors are `ConnectionError`, `QueryError` (the ORA number in `errorNum`), `MigrationError` and `QueryInputError`.
    - The package's suites run against Oracle Database Free 23 in CI. See the new DB Oracle page, which has an upgrade section.

### Patch Changes

- 840439a: Packages declare the runtime they are tested on: `engines.bun` `>=1.3.0` (the monorepo now builds and tests on Bun 1.3). `create-iskra`, a CLI that also runs under `npm create iskra`, declares `engines.node` `>=18`.

    Every package is published with an npm provenance attestation (`publishConfig.provenance`), linking each version to the commit and CI run that built it.

- cb3ec43: Register what each kit puts on the app with core's new registries: `app.context.get('db' | 'kv' | 'oracle')` returns the kit's driver, and the `process:*`, `socket:connected` / `socket:disconnected` and `worker:dead-letter` events have typed payloads. `ProcessManager.send()` takes `unknown` data.
- Updated dependencies [620da18]
- Updated dependencies [b635a2c]
- Updated dependencies [5b2b0fd]
- Updated dependencies [58d4a8f]
- Updated dependencies [5c70c5b]
- Updated dependencies [ec198d4]
- Updated dependencies [cb3ec43]
- Updated dependencies [ef2009b]
- Updated dependencies [840439a]
- Updated dependencies [dbf8817]
- Updated dependencies [3dc5581]
- Updated dependencies [9872d30]
- Updated dependencies [f2346f5]
- Updated dependencies [3579944]
    - @iskra-bun/core@0.2.0

## 0.1.1

### Patch Changes

- f9654df: Reject all pending requests when the Oracle bridge reports a fatal error or exits, instead of leaving their promises unsettled (which previously caused silent hangs and a memory leak).
- Updated dependencies [f9654df]
- Updated dependencies
- Updated dependencies [f9654df]
    - @iskra-bun/core@0.1.1

## 0.1.0

### Minor Changes

- Initial public release.
