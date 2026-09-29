# @iskra-bun/db-oracle

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
