# Migraciones

Sistema de migraciones basado en Drizzle Kit, integrado con `@iskra-bun/db-kit`.

## Configuracion

### 1. Crear el schema

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

### 2. Crear drizzle.config.ts

Usa el helper de `@iskra-bun/db-kit`:

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

## Comandos

### Via CLI

```bash
# Generar migraciones a partir de cambios en el schema
bun run packages/db-kit/src/cli.ts generate mi-migracion

# Aplicar migraciones pendientes
bun run packages/db-kit/src/cli.ts migrate

# Empujar schema directo a la DB (sin archivos de migracion, ideal para dev)
bun run packages/db-kit/src/cli.ts push

# Eliminar todas las tablas
bun run packages/db-kit/src/cli.ts drop
```

### Via bunx (directo con drizzle-kit)

```bash
bunx drizzle-kit generate --name mi-migracion
bunx drizzle-kit migrate
bunx drizzle-kit push
bunx drizzle-kit studio  # UI web para explorar la DB
```

### Programatico

Desde tu aplicacion:

```typescript
import { DbDriver } from '@iskra-bun/db-kit';

const db = new DbDriver();
app.register(db);
await app.start();

// Ejecutar migraciones pendientes
await db.runMigrations('./src/db/schema.ts', './drizzle');
```

O usando `MigrationHelper` directamente:

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

## Flujo de Trabajo Recomendado

1. **Desarrollo:** Usa `push` para iterar rapido sin generar archivos
2. **Pre-deploy:** Genera migraciones con `generate` y commiteá los archivos
3. **Deploy:** Ejecuta `migrate` en el startup de la app o en el CI/CD

```
Modificar schema.ts → generate → commit → deploy → migrate
```

## Estructura de Archivos

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

## Errores

Si una migracion falla, se tira `MigrationError` con el detalle del error:

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
