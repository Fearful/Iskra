---
"@iskra-bun/web-kit": minor
---

Runtime fixes for the `Kernel`, `/health` and `DbFeature`.

- `/health` now runs its checks on every request (not only with `includeDetails`) and answers **503** with `status: "error"` when one fails. The DB probe actually runs: it called `db.query("SELECT 1")`, but on a Drizzle instance `query` is an object, so the database was never checked. New `DbFeature.ping()` does one round-trip; every check has a timeout (`checkTimeoutMs`, default 2000).
- `DbFeature` uses a MySQL connection pool instead of a single connection.
- `Kernel.shutdown()` waits for in-flight requests (bounded by `shutdownGraceMs`, default 5000; Bun 1.1's graceful stop can otherwise hang forever after a 413), shuts features down in reverse dependency order, and continues past a failing feature (throwing an `AggregateError` at the end).
- A missing peer dependency no longer crashes the process with an unhandled rejection (the `import()` was fired without `await` inside a sync try/catch).
- **Breaking defaults:** the server binds `0.0.0.0` instead of `localhost` (which was unreachable from outside a container), and request bodies are capped at 16 MiB (`maxRequestBodySize`). `idleTimeout` is configurable.
- `securityHeaders` is merged over the defaults instead of replacing them, and `X-XSS-Protection` is no longer sent by default (OWASP recommends against it).
