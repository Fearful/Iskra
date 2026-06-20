# @iskra-bun/db-kit

## 0.2.0

### Minor Changes

- f9654df: New DB features and a migration fix:

    - **Fix:** `MigrationHelper` now passes `schemaPath`/`migrationsDir` (and an optional `configPath`) to drizzle-kit as `--schema`/`--out`/`--config` flags per command, instead of silently ignoring them when no `drizzle.config.ts` sits in the cwd.
    - `DbDriver.transaction(fn)` — typed wrapper around Drizzle's transaction so callers don't reach into the raw `db`.
    - `DbDriver.setOnQuery(cb)` — observability hook wired through Drizzle's logger to surface executed SQL + params.
    - `DbDriver.ping()` — runs a trivial liveness query and resolves `true`/`false` (never rejects), suitable for readiness probes.

### Patch Changes

- f9654df: `DbDriver` and `DbFeature` now accept an optional schema generic (`DbDriver<TSchema>` / `DbFeature<TSchema>`), so `.db` is a typed Drizzle database instead of `any` — opt-in callers get typed relational queries and autocomplete. The generic defaults preserve existing behavior, so no call site needs changes; consumers that relied on `any` may need to add a type argument or annotation.
- f9654df: Scrub credentials from the URL placed in `ConnectionError` context so passwords no longer leak into structured logs, and scrub `//user:pass@` credentials out of drizzle-kit stderr before storing it in `MigrationError` context. The MySQL driver now uses a connection pool (`createPool`) instead of a single serialized connection — note that `createPool` changes the MySQL lifecycle (pooled connections vs. a single serialized connection), so teardown now drains the pool via `end()`. `DbDriver.stop()` is hardened to swallow a throwing `end()`/`close()` (logging via `app.logger`) and to null the `client`/`db` handles so a post-stop `ping()`/`transaction()` hits the not-started guard instead of an already-closed connection.
- Scrub `//user:pass@` credentials out of the drizzle-kit stderr captured in `MigrationError.context.stderr`, so connection passwords no longer leak into migration error logs. Non-credential diagnostic text in stderr is preserved.
- Updated dependencies [f9654df]
- Updated dependencies
- Updated dependencies [f9654df]
    - @iskra-bun/core@0.1.1

## 0.1.0

### Minor Changes

- Initial public release.
