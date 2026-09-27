---
"@iskra-bun/process-kit": minor
---

**Breaking (0.x):** `ProcessManager#spawn()` rejects when the manager cannot start the process: before its App has initialized it (`ProcessManager is not initialized: register it on an App first`) and after `stop()` (`ProcessManager is stopped`). It used to resolve without starting anything, so the caller believed the process was running.
