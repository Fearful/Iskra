---
"@iskra-bun/db-oracle": minor
---

`instrumentOracle(oracle)` traces the driver: a CLIENT span per statement, commit and rollback, the child of the active span, with `db.system.name`, `db.operation.name`, `db.query.text` (the SQL as written, never the bind values) and `db.response.returned_rows`, and the error code of a failure. `oracle.onQuery(callback)` adds a hook besides `setOnQuery()`'s single one (and returns what removes it), and the hooks now see commits and rollbacks.
