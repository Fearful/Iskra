---
title: Migrations
description: Migration system based on Drizzle Kit, integrated with @iskra-bun/db-kit.
---

Migration system based on Drizzle Kit, integrated with `@iskra-bun/db-kit`.

## Configuration

### 1. Create the schema

```typescript
// src/db/schema.ts
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    createdAt: text('created_at').default('CURRENT_TIMESTAMP'),
});

export const posts = sqliteTable('posts', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    title: text('title').notNull(),
    content: text('content'),
    authorId: integer('author_id').references(() => users.id),
});
```

### 2. Create drizzle.config.ts

Use the helper from `@iskra-bun/db-kit`:

```typescript
// drizzle.config.ts
import { createDrizzleConfig } from '@iskra-bun/db-kit';

export default createDrizzleConfig({
    dialect: 'sqlite',
    dbUrl: process.env.DATABASE_URL || 'app.db',
    schemaPath: './src/db/schema.ts',
    migrationsDir: './drizzle',
});
```

## Commands

### Via CLI

```bash
# Generar migraciones a partir de cambios en el schema
bun run packages/db-kit/src/cli.ts generate mi-migracion

# Aplicar migraciones pendientes
bun run packages/db-kit/src/cli.ts migrate

# Empujar schema directo a la DB (sin archivos de migracion, ideal para dev)
bun run packages/db-kit/src/cli.ts push

# Delete a generated migration file (does not touch the database)
bun run packages/db-kit/src/cli.ts drop
```

### Via bunx (directly with drizzle-kit)

```bash
bunx drizzle-kit generate --name mi-migracion
bunx drizzle-kit migrate
bunx drizzle-kit push
bunx drizzle-kit studio  # UI web para explorar la DB
```

### Programmatic

From your application:

```typescript
import { DbDriver } from '@iskra-bun/db-kit';

const db = new DbDriver();
app.register(db);
await app.start();

// Apply the pending migrations in ./drizzle (created with `generate`)
// over the live connection. The first argument (schema) is not needed to apply.
await db.runMigrations(undefined, './drizzle');
```

Or using `MigrationHelper` directly:

```typescript
import { MigrationHelper } from '@iskra-bun/db-kit';

const helper = new MigrationHelper({
    dialect: 'sqlite',
    dbUrl: 'app.db',
    schemaPath: './src/db/schema.ts',
    migrationsDir: './drizzle',
});

await helper.generate('agregar-tabla-posts');
await helper.migrate();
```

## Recommended Workflow

1. **Development:** Use `push` to iterate quickly without generating files
2. **Pre-deploy:** Generate migrations with `generate` and commit the files
3. **Deploy:** Run `migrate` at app startup or in the CI/CD

```
Modificar schema.ts → generate → commit → deploy → migrate
```

## File Structure

```
mi-proyecto/
├── src/
│   └── db/
│       └── schema.ts         # Definicion de tablas
├── drizzle/
│   ├── 0000_initial.sql      # Migracion generada
│   ├── 0001_add-posts.sql    # Otra migracion
│   └── meta/                 # Metadata de drizzle-kit
├── drizzle.config.ts         # Config de drizzle-kit
└── app.config.ts             # Config de la app
```

## Errors

If a migration fails, a `MigrationError` is thrown with the error detail:

```typescript
import { MigrationError } from '@iskra-bun/db-kit';

try {
    await helper.migrate();
} catch (err) {
    if (err instanceof MigrationError) {
        console.error(err.code);    // 'MIGRATION_ERROR'
        console.error(err.context); // { operation: 'migrate', exitCode: 1, stderr: '...' }
    }
}
```
