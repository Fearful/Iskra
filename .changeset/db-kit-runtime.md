---
"@iskra-bun/db-kit": minor
---

Runtime fixes.

- `start()` does a `SELECT 1` round-trip before reporting "DB connected successfully". postgres-js and mysql2 connect lazily, so a wrong host or password used to surface only on the first query; `start()` now fails with a `ConnectionError` (credentials scrubbed) and closes the client.
- `runMigrations(schemaPath, migrationsDir)` now applies the migrations generated in `migrationsDir` over the live connection with Drizzle's migrator (postgres, mysql, sqlite, libsql). It used to spawn `drizzle-kit migrate`, which ignored both arguments and failed without a `drizzle.config.ts`. It requires a started driver; `schemaPath` is not needed to apply migrations. Failures are wrapped in `MigrationError`.
- Docs and CLI help: `drop` deletes a generated migration file (drizzle-kit's `drop`); it never dropped database tables as documented.
