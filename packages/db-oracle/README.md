# @iskra-bun/db-oracle

Oracle Database para Iskra: un pool de [node-oracledb](https://node-oracledb.readthedocs.io) en modo Thin dentro del proceso de la app (sin Oracle Client ni un proceso Node aparte), consultas tipadas con [Kysely](https://kysely.dev), binds con tipo por nombre, transacciones, paginación, búsqueda y migraciones.

## Instalacion

```bash
bun add @iskra-bun/db-oracle @iskra-bun/core
```

## Uso rapido

```typescript
import { App } from '@iskra-bun/core'
import { OracleDriver, search } from '@iskra-bun/db-oracle'

const app = new App({
  name: 'mi-app',
  // Sin esta seccion, el driver lee ORA_CONN, ORA_USER y ORA_PASSWORD
  oracle: { connectString: 'db-host:1521/FREEPDB1', user: 'app_user', password: process.env.ORA_PASSWORD },
})
const oracle = new OracleDriver<DB>()
app.register(oracle)

await app.start() // falla si no puede conectarse a Oracle

// SQL crudo, con outBinds tipados por nombre y rowsAffected
const { outBinds } = await oracle.execute(
  'INSERT INTO people (name) VALUES (:name) RETURNING id INTO :id',
  { name: 'Ana', id: { dir: 'returning', type: 'number' } },
)

// Kysely, busqueda y paginacion
const q = search(oracle.db!.selectFrom('PEOPLE').select(['ID', 'NAME']), ['NAME'], 'ana').orderBy('ID')
const page = await oracle.paginate(q, { page: 1, pageSize: 20 }) // { items, total, page, pageSize, pages }

// Migraciones SQL
await oracle.runMigrations('./migrations')
```

## Estado

Experimental (`0.x`): puede cambiar en una version minor. Las suites de integracion corren en CI contra Oracle Database Free 23.

## Documentacion

Guia completa: [@iskra-bun/db-oracle](https://iskra-docs.fly.dev/es/packages/db-oracle/)

## Licencia

AGPL-3.0-or-later
