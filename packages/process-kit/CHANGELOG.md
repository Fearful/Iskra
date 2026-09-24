# @iskra-bun/process-kit

## 0.2.0

### Minor Changes

- f9654df: New process-management features:

    - `spawn(name, config)` and `kill(name)` to add or gracefully remove individual processes at runtime, instead of only at boot.
    - Configurable exponential restart backoff (`restartBackoff: { initialMs, maxMs, factor }` on `ProcessConfig`) replacing the fixed 1s restart delay, so a crash-looping process backs off instead of hammering a broken dependency. Defaults to the previous 1s when unset.

### Patch Changes

- f9654df: `stop()` now shuts processes down gracefully — SIGTERM, wait for exit with a configurable timeout, then SIGKILL — and awaits exit before clearing state. `oneshot` mode is now implemented: the process runs to completion once and is never restarted, even when `restartOnCrash` is set.
- `terminate()` now detects orphaned processes: when a process survives both SIGTERM and SIGKILL, it logs an error (`survived SIGTERM and SIGKILL and is now an orphan`) via `app.logger` instead of failing silently. This is shared by `kill()` and `stop()`; a process that exits cleanly does not log.
- Updated dependencies [f9654df]
- Updated dependencies
- Updated dependencies [f9654df]
    - @iskra-bun/core@0.1.1

## 0.1.0

### Minor Changes

- Initial public release.
