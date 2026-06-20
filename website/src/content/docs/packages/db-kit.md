---
title: DB Kit
description: Database abstraction using Drizzle ORM (PostgreSQL, MySQL, SQLite).
---

Database abstraction using Drizzle ORM. It supports PostgreSQL, MySQL and SQLite.

## Quick Start

```typescript
import { App } from '@iskra-bun/core';
import { DbDriver } from '@iskra-bun/db-kit';

const app = new App({
    name: 'MiApp',
    db: {
        driver: 'sqlite',
        url: 'app.db',
    },
});

const db = new DbDriver();
app.register(db);

await app.start();

// Usar Drizzle ORM
const result = db.db.select().from(users).all();
```

## Supported Drivers

| Driver | Package | Example URL |
|--------|---------|----------------|
| `postgres` | postgres.js | `postgres://user:pass@localhost:5432/db` |
| `mysql` | mysql2 | `mysql://user:pass@localhost:3306/db` |
| `sqlite` | better-sqlite3 / bun:sqlite | `app.db` or `:memory:` |

The `DbDriver` automatically detects whether it is running on Bun and uses `bun:sqlite` instead of `better-sqlite3`.

## Typed Schema (Generics)

`DbDriver` accepts an optional Drizzle schema type parameter so `db.query.*` is
fully typed. Without the type argument the driver behaves exactly as before
(untyped, `Record<string, never>`).

```typescript
import * as schema from './src/db/schema';

// Pass your schema as the type argument
const db = new DbDriver<typeof schema>();
app.register(db);

await app.start();

// db.db is now typed: db.db.query.users.findMany() is fully inferred
const users = await db.db.query.users.findMany({ where: eq(schema.users.active, true) });
```

The exported helper types `IskraDrizzleDb<TSchema>` and `IskraDrizzleTx<TSchema>`
are available if you need to annotate function parameters:

```typescript
import type { IskraDrizzleDb, IskraDrizzleTx } from '@iskra-bun/db-kit';
```

## Schemas with Drizzle

```typescript
// src/db/schema.ts
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    createdAt: text('created_at').default('CURRENT_TIMESTAMP'),
});
```

## Transactions

Use `DbDriver.transaction(fn)` instead of reaching into the raw `db` handle.
Drizzle rolls back automatically on throw; failures are wrapped in `QueryError`.

```typescript
const result = await db.transaction(async (tx) => {
    await tx.insert(schema.orders).values({ userId: 1, total: 99 });
    await tx.update(schema.inventory).set({ stock: sql`stock - 1` }).where(eq(schema.inventory.id, 42));
    return { ok: true };
});
```

Signature:

```typescript
transaction<R>(fn: (tx: IskraDrizzleTx<TSchema>) => Promise<R>): Promise<R>
```

## Observability Hook

Register a callback that receives every SQL statement and its bound parameters.
Must be called **before** `app.start()` — the logger is wired at connection time.

```typescript
db.setOnQuery((query, params) => {
    console.log('[sql]', query, params);
    // forward to OpenTelemetry, Datadog, etc.
});

app.register(db);
await app.start();
```

Signature:

```typescript
setOnQuery(onQuery: (query: string, params: unknown[]) => void): void
```

A throwing callback is swallowed so observability never breaks a real query.

## Liveness Probe

`DbDriver.ping()` runs a trivial `SELECT 1` and resolves `true` on success or
`false` on any failure — it never rejects. Use it for readiness probes or health
endpoints (pairs well with web-kit's `addReadinessCheck`).

```typescript
const alive = await db.ping();
// true  → database is reachable
// false → not started, or connection dropped
```

Signature:

```typescript
ping(): Promise<boolean>
```

## Migrations

See [Migrations](/guides/migrations/) for the full guide.

```typescript
// Run migrations programmatically
await db.runMigrations('./src/db/schema.ts', './drizzle');
```

`runMigrations` delegates to `MigrationHelper`, which now correctly passes
`--schema` and `--out` flags to `drizzle-kit generate` and `--config` to all
commands. Previously, `schemaPath` and `migrationsDir` were silently ignored
unless a `drizzle.config.ts` was present in the working directory.

You can also use `MigrationHelper` directly if you need finer control:

```typescript
import { MigrationHelper } from '@iskra-bun/db-kit';

const helper = new MigrationHelper({
    dialect: 'sqlite',          // 'postgresql' | 'mysql' | 'sqlite'
    dbUrl: 'app.db',
    schemaPath: './src/db/schema.ts',
    migrationsDir: './drizzle',
    configPath: './drizzle.config.ts', // optional — passed as --config
});

await helper.generate('add_users');  // drizzle-kit generate --name add_users
await helper.migrate();              // drizzle-kit migrate
await helper.push();                 // drizzle-kit push (dev shortcut)
```

Flag mapping per command:

| Method | `--schema` | `--out` | `--config` |
|--------|-----------|---------|-----------|
| `generate` | yes | yes | if set |
| `migrate` | — | — | if set |
| `push` | yes | — | if set |
| `drop` | — | yes | if set |

## Errors

```typescript
import { ConnectionError, QueryError, MigrationError } from '@iskra-bun/db-kit';

// Thrown automatically on failure:
// ConnectionError: code='CONNECTION_ERROR'
// QueryError:     code='QUERY_ERROR'      (also thrown by transaction())
// MigrationError: code='MIGRATION_ERROR'
```
