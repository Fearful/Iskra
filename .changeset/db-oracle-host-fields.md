---
"@iskra-bun/db-oracle": minor
---

`app.config.oracle` takes `host`, `port` (default 1521) and `serviceName` instead of `connectString`, which they build as `host:port/serviceName`.
