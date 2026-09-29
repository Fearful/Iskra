---
"@iskra-bun/db-oracle": minor
---

db-oracle hardening, from a proof of concept on Oracle 19c.

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
