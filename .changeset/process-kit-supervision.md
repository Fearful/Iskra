---
"@iskra-bun/process-kit": minor
---

Supervision fixes.

- Children are spawned as process-group leaders and signals go to the whole group, so `kill()`/`stop()` also terminate the children of wrappers (`sh -c`, `npm run`, shell scripts), which used to be orphaned.
- A late exit from an older instance with the same name (after `kill()`+`spawn()` or a restart) no longer removes or restarts the current one.
- Restarts waiting out their backoff are tracked: `kill()` during the backoff cancels the restart (it used to throw "not found" while the timer respawned the process anyway), and `stop()` cancels them all.
- `start()` works again after `stop()`.
- **Behavior change:** `restartOnCrash` only restarts on a crash (non-zero exit code or death by signal); a clean exit with code 0 is not restarted. `process:exit` is now emitted for every mode as `{ name, exitCode, signal }`, with `exitCode: null` for signal deaths (previously reported as 0).
- `process:error` is emitted once per stderr line instead of per arbitrary chunk; the last stdout/stderr line is emitted even without a trailing newline, and line buffers are capped at 1 MiB.
