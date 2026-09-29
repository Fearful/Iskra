---
"@iskra-bun/db-oracle": minor
---

A `QueryError`'s `code` now says how to answer it over HTTP, which web-kit's response contract does on its own: `TIMEOUT` (504) for NJS-123 and a `DeadlineError`, `SERVICE_UNAVAILABLE` (503) for NJS-040 (no free connection), `CONFLICT` (409) for ORA-00001 (a unique constraint), and `QUERY_ERROR` (500) for the rest; all of them were `QUERY_ERROR`. A `QueryInputError` (a bad cursor or sort field from the request) is marked `expose`, so web-kit answers it 400 with its message instead of a 500.
