---
"@iskra-bun/db-kit": minor
---

New DB features and a migration fix:

- **Fix:** `MigrationHelper` now passes `schemaPath`/`migrationsDir` (and an optional `configPath`) to drizzle-kit as `--schema`/`--out`/`--config` flags per command, instead of silently ignoring them when no `drizzle.config.ts` sits in the cwd.
- `DbDriver.transaction(fn)` — typed wrapper around Drizzle's transaction so callers don't reach into the raw `db`.
- `DbDriver.setOnQuery(cb)` — observability hook wired through Drizzle's logger to surface executed SQL + params.
- `DbDriver.ping()` — runs a trivial liveness query and resolves `true`/`false` (never rejects), suitable for readiness probes.
