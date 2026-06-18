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

## Migrations

See [Migrations](/iskra/guides/migrations/) for the full guide.

```typescript
// Ejecutar migraciones programaticamente
await db.runMigrations('./src/db/schema.ts', './drizzle');
```

## Errors

```typescript
import { ConnectionError, QueryError, MigrationError } from '@iskra-bun/db-kit';

// Se tiran automaticamente cuando falla la conexion
// ConnectionError: code='CONNECTION_ERROR'
// QueryError: code='QUERY_ERROR'
// MigrationError: code='MIGRATION_ERROR'
```
