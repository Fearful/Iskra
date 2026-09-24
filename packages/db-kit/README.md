# @iskra-bun/db-kit

Base de datos SQL de Iskra con [Drizzle ORM](https://orm.drizzle.team). Soporta PostgreSQL, MySQL, SQLite y LibSQL, e incluye CLI de migraciones.

## Instalacion

```bash
bun add @iskra-bun/db-kit @iskra-bun/core
```

## Uso rapido

```typescript
import { App } from '@iskra-bun/core'
import { DbDriver } from '@iskra-bun/db-kit'

const app = new App({ name: 'mi-app' })
app.register(new DbDriver({ dialect: 'sqlite', url: 'app.db' }))

await app.start()
```

## Documentacion

Guia completa: [@iskra-bun/db-kit](https://iskra-docs.fly.dev/es/packages/db-kit/) · [Migraciones](https://iskra-docs.fly.dev/es/guides/migrations/)

## Licencia

AGPL-3.0-or-later
