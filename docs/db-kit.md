# @iskra-bun/db-kit

Abstraccion de base de datos usando Drizzle ORM. Soporta PostgreSQL, MySQL y SQLite.

## Inicio Rapido

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

## Drivers Soportados

| Driver | Paquete | URL de ejemplo |
|--------|---------|----------------|
| `postgres` | postgres.js | `postgres://user:pass@localhost:5432/db` |
| `mysql` | mysql2 | `mysql://user:pass@localhost:3306/db` |
| `sqlite` | better-sqlite3 / bun:sqlite | `app.db` o `:memory:` |

El `DbDriver` detecta automaticamente si esta corriendo en Bun y usa `bun:sqlite` en vez de `better-sqlite3`.

## Schemas con Drizzle

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

## Migraciones

Ver [Migraciones](./migraciones.md) para la guia completa.

```typescript
// Ejecutar migraciones programaticamente
await db.runMigrations('./src/db/schema.ts', './drizzle');
```

## Errores

```typescript
import { ConnectionError, QueryError, MigrationError } from '@iskra-bun/db-kit';

// Se tiran automaticamente cuando falla la conexion
// ConnectionError: code='CONNECTION_ERROR'
// QueryError: code='QUERY_ERROR'
// MigrationError: code='MIGRATION_ERROR'
```
