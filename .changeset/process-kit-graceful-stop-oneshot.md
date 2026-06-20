---
"@iskra-bun/process-kit": patch
---

`stop()` now shuts processes down gracefully — SIGTERM, wait for exit with a configurable timeout, then SIGKILL — and awaits exit before clearing state. `oneshot` mode is now implemented: the process runs to completion once and is never restarted, even when `restartOnCrash` is set.
