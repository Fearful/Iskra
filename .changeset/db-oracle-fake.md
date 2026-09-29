---
"@iskra-bun/db-oracle": minor
---

`fakeOracle()` in `@iskra-bun/db-oracle/testing` answers statements by SQL matchers (a string, a RegExp or a function) with rows, a result, a function or an error, records the calls with the SQL and binds as written, decodes rows by their spec, pages `list()` from the rows it answers, and counts a transaction's commits and rollbacks; `expectAllMatched()` names the rules nothing used. `OracleDatabase` (statements, `transaction()`, `ping()`) is the interface the driver and the fake share, for repositories that take either.
