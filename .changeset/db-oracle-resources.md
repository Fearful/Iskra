---
"@iskra-bun/db-oracle": minor
---

Helpers for raw SQL resources:

- `bindStyle: 'positional'` (config or per statement) compiles binds by name to binds by position before a statement runs, so a param the SQL does not use, a reserved word (`:date`) or a name in another case no longer fail it, and an array expands to an IN list; OUT binds come back by name. `bindDialect: 'sqlx'` reads placeholders as Go's sqlx does (`::` is a literal colon), for SQL copied from a Go service. `compileNamed(sql, params, dialect)` does it on its own.
- `oracle.list({ query | sql, filters, orders, totalFilters, offset/limit | page/pageSize, rows })` returns a page and its counts (`{ rows, total, filtered, offset, limit, pages }`), as DataTables' recordsTotal and recordsFiltered; a bad offset or limit from the request is a `QueryInputError`.
- `oracle.one()` returns the first row or throws a `NoRowsError` (`NOT_FOUND`, a 404 in web-kit).
- `rowSpec({ id: col.int(), activo: col.boolean(), … })` decodes each row by column type (a `CHAR(1)` flag, a NUMBER as plain decimal text, a bigint past 2^53), with Go sqlx's rules for extra and missing columns as options; `rows` also takes a Standard Schema. `query()`, `queryOne()`, `one()` and `list()` take it.
- A PL/SQL `RAISE_APPLICATION_ERROR` (ORA-20000 to ORA-20999) is a `CONFLICT` whose message (without `ORA-20xxx:` and the stack) is shown to the client; `QueryError.applicationError` has it.
- `OracleSession`, the interface the driver and a transaction share; a transaction also has `one()` and `list()`.
