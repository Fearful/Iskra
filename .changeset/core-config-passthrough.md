---
"@iskra-bun/core": patch
---

Fix: `loadAppConfig()` no longer drops the `db`, `kv` and `socket` sections (or process `maxRestarts` / `restartCooldown` / `restartBackoff`, or any custom key) from `app.config.ts`. The schema was a plain `z.object()`, which strips unknown keys, so `new App()` without an explicit config left `DbDriver` with "No DB configuration found" and `KVManager` silently on the memory adapter. Sections are now validated for shape and unknown keys are kept, matching `AppConfig`'s `[key: string]: any`.
