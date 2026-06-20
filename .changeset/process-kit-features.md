---
"@iskra-bun/process-kit": minor
"@iskra-bun/core": patch
---

New process-management features:

- `spawn(name, config)` and `kill(name)` to add or gracefully remove individual processes at runtime, instead of only at boot.
- Configurable exponential restart backoff (`restartBackoff: { initialMs, maxMs, factor }` on `ProcessConfig`) replacing the fixed 1s restart delay, so a crash-looping process backs off instead of hammering a broken dependency. Defaults to the previous 1s when unset.
