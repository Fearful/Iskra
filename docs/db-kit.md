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

## Schema Tipado (Generics)

`DbDriver` acepta un parametro de tipo Drizzle schema opcional para que
`db.query.*` quede completamente tipado. Sin el argumento de tipo, el driver
se comporta exactamente igual que antes (sin tipado, `Record<string, never>`).

```typescript
import * as schema from './src/db/schema';

// Pasar el schema como argumento de tipo
const db = new DbDriver<typeof schema>();
app.register(db);

await app.start();

// db.db queda tipado: db.db.query.users.findMany() esta completamente inferido
const users = await db.db.query.users.findMany({ where: eq(schema.users.active, true) });
```

Los tipos auxiliares `IskraDrizzleDb<TSchema>` e `IskraDrizzleTx<TSchema>` estan
disponibles para anotar parametros de funciones:

```typescript
import type { IskraDrizzleDb, IskraDrizzleTx } from '@iskra-bun/db-kit';
```

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

## Transacciones

Usa `DbDriver.transaction(fn)` en lugar de acceder directamente al handle `db`.
Drizzle hace rollback automaticamente al lanzar una excepcion; los fallos se
envuelven en `QueryError`.

```typescript
const result = await db.transaction(async (tx) => {
    await tx.insert(schema.orders).values({ userId: 1, total: 99 });
    await tx.update(schema.inventory).set({ stock: sql`stock - 1` }).where(eq(schema.inventory.id, 42));
    return { ok: true };
});
```

Firma:

```typescript
transaction<R>(fn: (tx: IskraDrizzleTx<TSchema>) => Promise<R>): Promise<R>
```

## Hook de Observabilidad

Registra un callback que recibe cada sentencia SQL y sus parametros vinculados.
Debe llamarse **antes** de `app.start()`, ya que el logger se configura al
momento de la conexion.

```typescript
db.setOnQuery((query, params) => {
    console.log('[sql]', query, params);
    // reenviar a OpenTelemetry, Datadog, etc.
});

app.register(db);
await app.start();
```

Firma:

```typescript
setOnQuery(onQuery: (query: string, params: unknown[]) => void): void
```

Un callback que lanza una excepcion es capturado silenciosamente para que la
observabilidad nunca interrumpa una consulta real.

## Sonda de Liveness

`DbDriver.ping()` ejecuta un `SELECT 1` trivial y resuelve `true` si tiene
exito o `false` ante cualquier fallo — nunca rechaza. Usalo para sondas de
readiness o endpoints de salud (funciona bien con `addReadinessCheck` de
web-kit).

```typescript
const alive = await db.ping();
// true  → la base de datos es accesible
// false → no iniciado, o conexion caida
```

Firma:

```typescript
ping(): Promise<boolean>
```

## Migraciones

Ver [Migraciones](./migraciones.md) para la guia completa.

```typescript
// Ejecutar migraciones programaticamente
await db.runMigrations('./src/db/schema.ts', './drizzle');
```

`runMigrations` delega a `MigrationHelper`, que ahora pasa correctamente los
flags `--schema` y `--out` a `drizzle-kit generate` y `--config` a todos los
comandos. Anteriormente, `schemaPath` y `migrationsDir` se ignoraban
silenciosamente a menos que existiera un `drizzle.config.ts` en el directorio
de trabajo.

Tambien puedes usar `MigrationHelper` directamente para mayor control:

```typescript
import { MigrationHelper } from '@iskra-bun/db-kit';

const helper = new MigrationHelper({
    dialect: 'sqlite',          // 'postgresql' | 'mysql' | 'sqlite'
    dbUrl: 'app.db',
    schemaPath: './src/db/schema.ts',
    migrationsDir: './drizzle',
    configPath: './drizzle.config.ts', // opcional — se pasa como --config
});

await helper.generate('add_users');  // drizzle-kit generate --name add_users
await helper.migrate();              // drizzle-kit migrate
await helper.push();                 // drizzle-kit push (atajo para desarrollo)
```

Mapeo de flags por comando:

| Metodo | `--schema` | `--out` | `--config` |
|--------|-----------|---------|-----------|
| `generate` | si | si | si se define |
| `migrate` | — | — | si se define |
| `push` | si | — | si se define |
| `drop` | — | si | si se define |

## Errores

```typescript
import { ConnectionError, QueryError, MigrationError } from '@iskra-bun/db-kit';

// Se tiran automaticamente cuando falla la conexion:
// ConnectionError: code='CONNECTION_ERROR'
// QueryError:     code='QUERY_ERROR'      (tambien lanzado por transaction())
// MigrationError: code='MIGRATION_ERROR'
```
