---
"@iskra-bun/core": patch
---

`createLogger` now enables `pino-pretty` only when `NODE_ENV !== 'production'`. In production it emits structured JSON with no transport, so logs pipe cleanly to aggregators and containers.
