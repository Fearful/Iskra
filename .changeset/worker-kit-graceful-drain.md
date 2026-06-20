---
"@iskra-bun/worker-kit": patch
---

`stop()` now drains in-flight jobs by fully closing the worker before closing the queue, instead of closing both concurrently (which could leave a running job stuck in the `active` state).
