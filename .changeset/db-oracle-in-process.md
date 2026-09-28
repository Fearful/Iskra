---
"@iskra-bun/db-oracle": minor
---

**Breaking:** db-oracle runs node-oracledb in the app's process and covers what db-kit does (still experimental).

- The Node bridge (`bridge/runner.js`) is gone: the driver opens a node-oracledb pool in Thin mode (no Oracle Client, no `node`), and `oracledb` is a dependency. `new OracleDriver()` takes no arguments (the bridge path and timeouts are gone); the connection comes from the new `app.config.oracle` (`connectString`, `user`, `password`, `pool`, `fetchAsString`, `camelCase`, `poolAttributes`) or, as before, `ORA_CONN`, `ORA_USER` and `ORA_PASSWORD`. `start()` fails with a `ConnectionError` carrying Oracle's message when the database cannot be reached. The driver's `name` is `"OracleDriver"` (it was `"db"`, the same as db-kit's `DbDriver`).
- `execute(sql, binds)` returns `{ rows, rowsAffected, outBinds }`, and `executeMany()` runs a bulk insert in one round trip. A bind may name its type — `{ dir: 'out' | 'inout' | 'returning', type: 'number' }`, `{ type: 'clob', val }` — and `outBinds` is typed from those binds (a `returning` bind is an array, one value per row). `query()` still returns the rows. CLOBs are read as strings and BLOBs as Buffers, since a Lob cannot outlive its pooled connection; `fetchAsString: ['number']` keeps the digits of NUMBERs past 2^53.
- `oracle.db` is Kysely, typed by `OracleDriver<DB>`, on an Oracle dialect of Iskra's own (`:1` binds, table aliases without `AS`, `limit()` compiled as `FETCH NEXT`), with optional camelCase names. `sql` and Kysely's types are re-exported.
- `transaction(fn)` runs raw and Kysely statements on one connection and commits, or rolls back and rethrows the callback's error as it is; Kysely's transactions work too, with isolation levels and savepoints. Outside a transaction a statement commits on its own.
- Pagination and search: `paginate()` / `oracle.paginate()` (`OFFSET … FETCH` and the total), `paginateByCursor()` (keyset, composite keys), `search()` (case-insensitive `LIKE` across columns, the term's `%` and `_` matching themselves) and `sortBy()` (a request's sort fields, from an allowlist). A bad cursor or sort field throws a `QueryInputError` (`VALIDATION_ERROR`), for a 400.
- `stream()` and Kysely's `.stream()` read large results in chunks. `runMigrations(dir)` applies SQL*Plus-style `.sql` files once each, recorded with a checksum in `ISKRA_MIGRATIONS` and serialized across instances by a table lock. `ping()` and `setOnQuery()` work as in db-kit.
- Errors are `ConnectionError`, `QueryError` (the ORA number in `errorNum`), `MigrationError` and `QueryInputError`.
- The package's suites run against Oracle Database Free 23 in CI. See the new DB Oracle page, which has an upgrade section.
