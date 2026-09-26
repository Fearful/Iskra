---
"@iskra-bun/process-kit": patch
---

A crashed process is restarted only once the children it left behind have exited, as the docs say. Terminating them was not awaited, so a restart whose backoff was shorter than their exit ran next to them (holding the same port, say). The pending restart stays cancellable by `kill()` and `stop()` while it waits, and `stop()` waits for those children to be gone too.
