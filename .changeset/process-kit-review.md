---
"@iskra-bun/process-kit": patch
---

`kill()` and `stop()` now wait for the whole process group, and SIGKILL it when anything in it is still alive after the graceful timeout: a grandchild that ignored SIGTERM used to outlive a wrapper that exited on it. A crashed process's leftover children are terminated before it is restarted, instead of piling up with every restart. `stop()` no longer leaves a timer that kept the event loop alive for twice the timeout. `send()` to a process that closed its stdin logs the broken pipe instead of raising an unhandled rejection. `spawn()` rejects when the command cannot be spawned; at `app.start()` and on a restart that failure is emitted as `process:spawn-error` and retried with the restart backoff instead of silently ending supervision.
