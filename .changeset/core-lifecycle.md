---
"@iskra-bun/core": minor
---

Lifecycle fixes and graceful shutdown.

- `app.start()` starts drivers one at a time in registration order; if one fails, the drivers already started are stopped in reverse order before the error is rethrown (previously `Promise.all` left them running, with ports bound and child processes alive).
- `app.stop()` stops drivers in reverse start order, continues past failures, and always shuts down OpenTelemetry (a failing driver used to skip the span/metric flush).
- Async `plugin.install()` is awaited during `start()`, so its failure is reported instead of crashing the process as an unhandled rejection.
- New: `SIGTERM`/`SIGINT` trigger a graceful `stop()` and exit (0, or 1 on failure/timeout). Configure with `shutdownSignals` (`false` to disable) and `shutdownTimeoutMs` (default 10000); disabled under `NODE_ENV=test`.
