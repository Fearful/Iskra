---
"@iskra-bun/db-kit": patch
---

`transaction()` with `sqlite` now rolls back when the async callback throws: Drizzle's bun-sqlite transaction is synchronous and committed as soon as the callback returned its promise. sqlite transactions run one at a time, and a nested `transaction()` call is rejected instead of waiting for itself. `scrubUrl()` and `scrubCredentials()` also redact secret query parameters such as libsql's `authToken`, and passwords containing a raw `@` or `/`; the connection error's context no longer carries the libsql token.
