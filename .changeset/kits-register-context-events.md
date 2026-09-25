---
"@iskra-bun/db-kit": patch
"@iskra-bun/kv-kit": patch
"@iskra-bun/db-oracle": patch
"@iskra-bun/process-kit": patch
"@iskra-bun/socket-kit": patch
"@iskra-bun/worker-kit": patch
---

Register what each kit puts on the app with core's new registries: `app.context.get('db' | 'kv' | 'oracle')` returns the kit's driver, and the `process:*`, `socket:connected` / `socket:disconnected` and `worker:dead-letter` events have typed payloads. `ProcessManager.send()` and `OracleDriver.query()` take `unknown` data.
