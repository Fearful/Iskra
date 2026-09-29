---
"@iskra-bun/web-kit": minor
---

`LoggerFeature` writes through the Kernel's logger when it has fields (the App's pino, with WebPlugin): a request's `c.get('logger')` is a child with its `requestId`, and `accessLog: true` writes one `request completed` line per request with `method`, `path`, `status`, `durationMs`, `requestId` and `actor` as fields. It used to write `[INFO]` text to the console whatever the app's logger was. `KernelLogger` takes an optional `child()`, which `fromStructuredLogger()` provides.
