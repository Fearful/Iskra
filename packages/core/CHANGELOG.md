# @iskra-bun/core

## 0.1.1

### Patch Changes

- f9654df: `createLogger` now enables `pino-pretty` only when `NODE_ENV !== 'production'`. In production it emits structured JSON with no transport, so logs pipe cleanly to aggregators and containers.
- `createLogger` now redacts sensitive fields from log output. Keys such as `password`, `pass`, `apiKey`, `token` and `secret` (including nested occurrences), along with `config.env` and `*.data`, are replaced with `[REDACTED]` in both development and production, so credentials and config no longer leak into logs.
- f9654df: New process-management features:

    - `spawn(name, config)` and `kill(name)` to add or gracefully remove individual processes at runtime, instead of only at boot.
    - Configurable exponential restart backoff (`restartBackoff: { initialMs, maxMs, factor }` on `ProcessConfig`) replacing the fixed 1s restart delay, so a crash-looping process backs off instead of hammering a broken dependency. Defaults to the previous 1s when unset.

## 0.1.0

### Minor Changes

- Initial public release.
