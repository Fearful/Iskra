---
"@iskra-bun/kv-kit": minor
"@iskra-bun/worker-kit": patch
"@iskra-bun/db-kit": patch
"@iskra-bun/process-kit": patch
---

`KVManager` throws when its constructor gets `adapter`, `driver` or `connection`: the store is chosen by the App config (`kv: { driver, connection }`), and the README's `new KVManager({ adapter: 'redis' })` was silently ignored, leaving the app on per-process memory. Without a `kv` driver it now logs a warning in production instead of an info line. The READMEs of kv-kit, worker-kit (`connection` and `queueName`, not `queue`), db-kit (the App's `db` config) and process-kit (the App's `processes` config) show working examples.
