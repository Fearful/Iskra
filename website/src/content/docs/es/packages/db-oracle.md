---
title: DB Oracle
description: Oracle Database con un pool de node-oracledb en el proceso de la app, Kysely, paginación y migraciones.
---

:::caution[Experimental]
`@iskra-bun/db-oracle` está en `0.x` y puede cambiar en una versión minor (ver [VERSIONING.md](https://github.com/fearful/iskra/blob/main/VERSIONING.md)). Sus suites de integración corren en CI contra Oracle Database Free 23.
:::

Oracle Database para Iskra. El driver corre un pool de [node-oracledb](https://node-oracledb.readthedocs.io) en **modo Thin** dentro del proceso Bun de la app: sin librerías de Oracle Client y sin un proceso Node al costado. Encima de eso:

- SQL crudo con binds por nombre, incluidos binds OUT y `RETURNING INTO` con el tipo por nombre, y `rowsAffected`;
- consultas tipadas con [Kysely](https://kysely.dev) (`oracle.db`);
- transacciones, streaming, paginación (por offset y por cursor), búsqueda y orden desde los parámetros del request;
- migraciones en archivos SQL.

## Inicio rápido

```bash
bun add @iskra-bun/db-oracle @iskra-bun/core
```

```typescript
import { App } from '@iskra-bun/core';
import { OracleDriver } from '@iskra-bun/db-oracle';

const app = new App({
    name: 'mi-app',
    oracle: {
        connectString: 'db-host:1521/FREEPDB1',
        user: process.env.ORA_USER,
        password: process.env.ORA_PASSWORD,
    },
});
const oracle = new OracleDriver<DB>(); // DB: los tipos de tus tablas (ver Kysely más abajo)
app.register(oracle);

await app.start(); // falla con un ConnectionError si no llega a Oracle

const people = await oracle.query('SELECT id, name FROM people WHERE city = :city', { city: 'Rosario' });
const rows = await oracle.db!.selectFrom('PEOPLE').select(['ID', 'NAME']).execute();
```

Conectate con un usuario propio de la app que tenga solo los permisos que usa (`CREATE SESSION` y los de sus tablas), nunca con `SYSTEM` o `SYS`.

## Configuración

`app.config.oracle` (tipada como `OracleConfig`). Sin ella, el driver lee `ORA_CONN`, `ORA_USER` y `ORA_PASSWORD`; sin ninguna de las dos, avisa en el log y no arranca.

| Opción | Default | |
|---|---|---|
| `connectString` | — | Easy Connect (`host:1521/FREEPDB1`, `tcps://…`), un alias TNS o un descriptor completo. |
| `user`, `password` | — | |
| `pool.min` / `pool.max` / `pool.increment` | 0 / 4 / 1 | Conexiones que quedan abiertas sin uso, máximo abiertas, y cuántas abre por vez. |
| `pool.queueTimeout` | 60000 | Milisegundos que un pedido espera una conexión libre antes de fallar (NJS-040). |
| `pool.drainTime` | 5 | Segundos que `stop()` deja terminar a las conexiones en uso. |
| `fetchAsString` | `[]` | `'number'` para leer los NUMBER como string (pasado 2^53 un number de JS pierde dígitos); `'date'` para DATE y TIMESTAMP como texto. |
| `camelCase` | `false` | Solo Kysely: escribís `firstName` para la columna `FIRST_NAME`, y las filas vuelven en camelCase. |
| `poolAttributes` | `{}` | Otros atributos del pool de node-oracledb (`walletLocation`, `configDir`…), tal cual. |

`start()` abre el pool y corre `SELECT 1 FROM DUAL`, así que una contraseña o un host incorrectos hacen fallar el arranque de la app. `stop()` cierra el pool. `ping()` resuelve `true` o `false` (nunca lanza), para readiness checks.

## SQL crudo

```typescript
// Las filas de una consulta, como objetos por nombre de columna (en mayúsculas, como Oracle)
const rows = await oracle.query<{ ID: number; NAME: string }>('SELECT id, name FROM people WHERE id = :id', { id: 1 });

// Cualquier sentencia: rows, rowsAffected y outBinds
const { rowsAffected, outBinds } = await oracle.execute(
    'INSERT INTO people (name) VALUES (:name) RETURNING id INTO :id',
    { name: 'Ana', id: { dir: 'returning', type: 'number' } },
);
outBinds.id; // number[]: un valor por fila insertada

// Una carga masiva en un solo viaje
await oracle.executeMany('INSERT INTO people (name) VALUES (:name)', [{ name: 'Ana' }, { name: 'Bea' }]);
```

Los binds van por nombre (`:id` y `{ id }`) o por posición (`:1`, `:2` y un array). Fuera de una transacción, cada sentencia hace commit sola.

### Binds con tipo por nombre

Un bind puede ser un objeto con un `type` de esta tabla, en vez de importar las constantes de node-oracledb. `outBinds` queda tipado a partir de esos objetos.

| `type` | Oracle | Valor en JS |
|---|---|---|
| `string` | VARCHAR2 | string |
| `number` | NUMBER | number |
| `date` / `timestamp` | DATE / TIMESTAMP | Date |
| `clob` | CLOB | string |
| `blob` / `raw` | BLOB / RAW | Buffer |
| `boolean` | BOOLEAN (23ai, o PL/SQL) | boolean |

| Bind | Para | `outBinds.nombre` |
|---|---|---|
| `{ type: 'clob', val: texto }` | un valor IN de ese tipo (un texto largo a un CLOB) | — |
| `{ dir: 'out', type }` | un parámetro OUT de PL/SQL | el valor, o null |
| `{ dir: 'inout', type, val }` | un parámetro IN OUT de PL/SQL | el valor, o null |
| `{ dir: 'returning', type }` | `RETURNING … INTO :nombre` de un INSERT, UPDATE o DELETE | un array, un valor por fila |

`maxSize` fija los bytes de un bind de salida `string` (default 4000) o `raw` (default 2000).

```typescript
const { outBinds } = await oracle.execute(
    'BEGIN app_pkg.register(:email, :userId, :status); END;',
    {
        email: 'ana@example.com',
        userId: { dir: 'out', type: 'number' },
        status: { dir: 'out', type: 'string', maxSize: 50 },
    },
);
outBinds.userId; // number | null
```

### LOBs, fechas y números

Las columnas CLOB se leen como string y las BLOB como Buffer, enteras: un Lob de node-oracledb solo se puede leer mientras su conexión está abierta, y el pool la recupera cuando termina la sentencia. Un bind de salida CLOB o BLOB se lee igual. Para un LOB muy grande, leelo por partes con `DBMS_LOB.SUBSTR`.

Los valores DATE y TIMESTAMP no llevan zona horaria: node-oracledb escribe y lee un `Date` en la hora local del proceso, así que un valor vuelve igual. Poné `TZ=UTC` en la app si otros clientes leen las mismas columnas.

## Kysely

`oracle.db` es una instancia de Kysely sobre el pool, tipada por el parámetro `DB`. Iskra trae su propio dialecto de Oracle para Kysely: binds `:1`, alias de tabla sin `AS`, `offset … rows`, y `limit(n)` compilado como `fetch next n rows only`, porque Oracle no tiene LIMIT. `sql` y los tipos de Kysely se reexportan:

```typescript
import { OracleDriver, sql, type Generated } from '@iskra-bun/db-oracle';

interface DB {
    PEOPLE: { ID: Generated<number>; NAME: string; CITY: string | null; CREATED: Date };
}

const oracle = new OracleDriver<DB>();
// …
const db = oracle.db!;
await db.insertInto('PEOPLE').values({ NAME: 'Ana', CITY: 'Rosario', CREATED: new Date() }).execute();
const latest = await db.selectFrom('PEOPLE').selectAll().orderBy('CREATED', 'desc').limit(10).execute();
const { numUpdatedRows } = await db.updateTable('PEOPLE').set({ CITY: 'Córdoba' }).where('ID', '=', 1).executeTakeFirst();
```

Oracle guarda en mayúsculas los nombres sin comillas, así que las tablas y columnas son `PEOPLE` e `ID`. Con `camelCase: true` escribís `people` y `firstName` (por `FIRST_NAME`) y las filas vuelven en camelCase; las filas de `query()` mantienen los nombres de Oracle.

Para generar los tipos `DB` desde una base, usá el `generate` de [kysely-oracledb](https://www.npmjs.com/package/kysely-oracledb) en un script aparte (dependencia de desarrollo); su opción `camelCase` corresponde a `camelCase: true`. Tipa las columnas BLOB como `string`: cambialas a `Buffer`, que es lo que devuelve el driver.

No se soporta con Kysely: `returning()` (usá `execute()` con binds `dir: 'returning'`), el `Migrator` de Kysely (usá [`runMigrations()`](#migraciones)) ni la introspección.

## Transacciones

```typescript
const orderId = await oracle.transaction(async (tx) => {
    const { outBinds } = await tx.execute(
        'INSERT INTO orders (customer_id) VALUES (:customerId) RETURNING id INTO :id',
        { customerId, id: { dir: 'returning', type: 'number' } },
    );
    await tx.db.insertInto('ORDER_LINES').values(lines.map((l) => ({ ...l, ORDER_ID: outBinds.id[0]! }))).execute();
    return outBinds.id[0];
});
```

`transaction(fn)` corre `fn` en una sola conexión con autoCommit apagado: `tx.query`, `tx.execute`, `tx.executeMany` y `tx.db` (Kysely) la comparten. Hace commit cuando `fn` termina y rollback cuando lanza, y relanza el error tal cual (un `NotFoundError` sigue siendo un 404). Las transacciones propias de Kysely también funcionan, con niveles de aislamiento (`read committed`, `serializable`) y savepoints:

```typescript
await oracle.db!.transaction().setIsolationLevel('serializable').execute(async (trx) => {
    // …
});
```

Oracle no tiene transacciones anidadas: abrir una dentro de otra lanza un error.

## Paginación, búsqueda y orden

```typescript
import { search, sortBy, QueryInputError } from '@iskra-bun/db-oracle';
import { defineRoute, ValidationError } from '@iskra-bun/web-kit';

defineRoute({
    method: 'GET',
    path: '/people',
    handler: async (ctx) => {
        const param = (name: string) => ctx.raw.req.query(name);
        try {
            let q = oracle.db!.selectFrom('PEOPLE').select(['ID', 'NAME', 'CITY']);
            q = search(q, ['NAME', 'CITY'], param('q'));
            q = sortBy(q, param('sort'), ['NAME', 'CITY']).orderBy('ID');
            return await oracle.paginate(q, { page: param('page'), pageSize: param('pageSize') });
        } catch (error) {
            if (error instanceof QueryInputError) throw new ValidationError(error.message);
            throw error;
        }
    },
});
// → { items, total, page, pageSize, pages }
```

- **`oracle.paginate(query, { page, pageSize })`** (o `paginate(db, query, options)` con el `db` de una transacción) trae la página con `OFFSET … FETCH NEXT` y un conteo de toda la consulta. La página y su tamaño pueden ser strings de un query string; un valor inválido vuelve al default, y el tamaño tiene un tope `maxPageSize` (default 100). La consulta necesita un `orderBy` que termine en una columna única: sin él Oracle devuelve las filas en cualquier orden, y las páginas repetirían o saltearían filas.
- **`paginateByCursor(query, { keys, after, pageSize, direction })`** pagina por claves (keyset): una página profunda no cuesta más que la primera, y las filas insertadas mientras tanto no corren las páginas. Ordena por `keys`, que tienen que estar seleccionadas, no ser NULL y ser únicas en conjunto (terminá con la clave primaria), y devuelve `{ items, nextCursor }`. Pasá `nextCursor` como `after` para la página siguiente; en la última es null.
- **`search(query, columns, term)`** deja las filas donde alguna de `columns` contiene `term`, sin distinguir mayúsculas (`upper(col) like :term escape '\'`). El término es un bind, y sus `%` y `_` se buscan literalmente. Un término vacío deja la consulta como está.
- **`sortBy(query, sort, allowed)`** ordena por un parámetro como `name,-created` (`-` para descendente), aceptando solo los campos de `allowed`. Agregá una columna única después para desempatar.

Un cursor mal formado o un campo fuera de `allowed` lanza un `QueryInputError` (código `VALIDATION_ERROR`). Viene del cliente, así que respondé 400, como arriba.

## Streaming

Para exportaciones y otros resultados grandes, leé las filas a medida que llegan en vez de todas juntas:

```typescript
for await (const row of oracle.stream('SELECT * FROM audit_log ORDER BY id', [], { chunkSize: 500 })) {
    write(row);
}
for await (const row of oracle.db!.selectFrom('AUDIT_LOG').selectAll().stream(500)) {
    write(row);
}
```

La conexión queda tomada hasta que termina el loop (o se corta con `break`).

## Migraciones

```typescript
await app.start();
const applied = await oracle.runMigrations('./migrations'); // ['001_people.sql', …]
```

`runMigrations(dir)` aplica los archivos `.sql` de `dir` que todavía no están registrados, por orden de nombre (los números se comparan como números: `2_…` antes que `10_…`). Un archivo tiene sentencias al estilo SQL*Plus: una sentencia SQL termina con `;`, y un bloque PL/SQL (`BEGIN`, `DECLARE`, `CREATE PROCEDURE`/`FUNCTION`/`PACKAGE`/`TRIGGER`/`TYPE`) termina con una línea que solo tiene `/`.

```sql
-- migrations/001_people.sql
CREATE TABLE people (
    id      NUMBER GENERATED BY DEFAULT ON NULL AS IDENTITY PRIMARY KEY,
    name    VARCHAR2(100) NOT NULL,
    created TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
);
CREATE INDEX people_name ON people (name);

CREATE OR REPLACE TRIGGER people_name_trim
BEFORE INSERT ON people FOR EACH ROW
BEGIN
    :NEW.name := TRIM(:NEW.name);
END;
/
```

- Los archivos aplicados quedan registrados en `ISKRA_MIGRATIONS` (`{ table }` para otro nombre) con un checksum: un archivo que cambió después de aplicarse se rechaza.
- Las corridas se serializan con un lock sobre `ISKRA_MIGRATIONS_LOCK`: varias instancias que arrancan a la vez aplican cada archivo una sola vez. Otra corrida espera hasta `lockTimeout` segundos (default 60).
- Las sentencias de un archivo y su registro hacen commit juntos, pero **Oracle hace commit de cada sentencia DDL por su cuenta**: un archivo que falla a mitad de camino conserva el DDL anterior a la falla, y su DML desde el último DDL se revierte. Separá el DDL y los cambios de datos en archivos distintos, y escribí DDL que se pueda volver a correr (o arreglalo a mano) cuando un archivo falla.

## Readiness y observabilidad

```typescript
import { HealthCheckFeature } from '@iskra-bun/web-kit';

const health = new HealthCheckFeature();
health.addReadinessCheck('oracle', () => oracle.ping());

// Cada sentencia (cruda y de Kysely) y sus binds; un callback que lanza se ignora
oracle.setOnQuery((sql, binds) => app.logger.debug({ sql }, 'oracle query'));
```

Los binds pueden tener datos personales: registralos solo donde eso sea aceptable.

## Errores

| Error | Cuándo |
|---|---|
| `ConnectionError` | `start()` no pudo abrir el pool ni llegar a la base. Su mensaje trae el de Oracle (`ORA-01017: …`); su contexto, el connect string y el usuario, nunca la contraseña. |
| `QueryError` | Falló una sentencia. `error.errorNum` es el número ORA (`1` para ORA-00001, una restricción única: respondé 409) y `context.oracleCode` el código; el error original es `cause`. |
| `MigrationError` | Falló una migración (su contexto nombra el archivo y la sentencia), cambió después de aplicarse, o venció la espera del lock. |
| `QueryInputError` | Un cursor de paginación o un campo de orden del request no es válido: un 400. |
| `ConfigError` (core) | `app.config.oracle` no es válida. |

## Actualizar desde 0.1

La 0.1 corría las consultas a través de un proceso Node (`bridge/runner.js`).

- Ya no hay puente: no hace falta `node`, y `oracledb` es una dependencia del paquete (no se instala aparte).
- `new OracleDriver()` no recibe argumentos: la ruta del puente y los timeouts ya no existen (usá `pool.queueTimeout`). La conexión sale de `app.config.oracle`, o todavía de `ORA_CONN`, `ORA_USER` y `ORA_PASSWORD`.
- `query(sql, params)` sigue devolviendo las filas, y una sentencia sigue haciendo commit sola; para sentencias que hacen commit o rollback juntas, usá `transaction()`.
- El `name` del driver es `'OracleDriver'` (era `'db'`, igual que el `DbDriver` de db-kit).
- Los errores son `QueryError` con el número ORA en vez de `Error` comunes.
