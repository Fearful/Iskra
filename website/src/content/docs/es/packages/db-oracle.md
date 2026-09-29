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
| `host`, `port`, `serviceName` | —, 1521, — | En vez de `connectString`: arman `host:port/serviceName` (ver [`fromEnv`](/es/packages/config-kit/#fromenv-la-sección-de-un-kit-desde-tus-nombres-de-variables) de config-kit para leerlos de tus variables). |
| `user`, `password` | — | |
| `pool.min` / `pool.max` / `pool.increment` | 0 / 4 / 1 | Conexiones que quedan abiertas sin uso, máximo abiertas, y cuántas abre por vez. |
| `pool.queueTimeout` | 60000 | Milisegundos que un pedido espera una conexión libre antes de fallar (NJS-040). |
| `pool.drainTime` | 5 | Segundos que `stop()` deja terminar a las conexiones en uso. |
| `fetchAsString` | `[]` | `'number'` para leer los NUMBER como string (pasado 2^53 un number de JS pierde dígitos); `'date'` para DATE y TIMESTAMP como texto. |
| `camelCase` | `false` | Solo Kysely: escribís `firstName` para la columna `FIRST_NAME`, y las filas vuelven en camelCase. |
| `poolAttributes` | `{}` | Otros atributos del pool de node-oracledb (`walletLocation`, `configDir`…), tal cual. |
| `callTimeout` | 30000 | Milisegundos que puede correr una sentencia antes de cancelarse (ver [Timeouts](#timeouts-y-cancelación)); 0 para sin límite. |
| `deadlineGrace` | el timeout, hasta 5000 | Milisegundos que el driver espera, pasado el timeout de una llamada, a que node-oracledb la cancele antes de abandonar la conexión por su cuenta (ver [Timeouts](#timeouts-y-cancelación)). |
| `pingTimeout` | 5000 | Milisegundos que `ping()` espera antes de responder `false`. |
| `dropUnusedBinds` | `false` | Descartar los binds por nombre que el SQL no usa, en vez de fallar. |
| `bindStyle` | `'named'` | `'positional'` compila los binds por nombre a binds por posición (ver [Binds por posición](#binds-por-posición-bindstyle)). |
| `bindDialect` | `'oracle'` | Cómo lee `:nombre` el modo `'positional'`: `'oracle'`, o `'sqlx'` para SQL copiado de Go. |
| `compatibility` | `'19c'` | La base más vieja en la que tiene que correr el SQL de Kysely: `'19c'` rechaza lo que solo entiende 23ai (ver [Kysely](#kysely)); `'23ai'` lo permite. |

`start()` abre el pool y corre `SELECT 1 FROM DUAL`, así que una contraseña o un host incorrectos hacen fallar el arranque de la app; después `oracle.serverVersion` tiene la versión mayor de la base (19, 21, 23…). `stop()` cierra el pool. `ping()` resuelve `true` o `false` dentro de `pingTimeout` (nunca lanza), para readiness checks: con todas las conexiones ocupadas responde `false` a tiempo en vez de esperar una, y una conexión que sigue corriendo el ping después de `pingTimeout` se descarta.

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

// Solo la primera fila (trae solo esa), o undefined
const person = await oracle.queryOne<{ NAME: string }>('SELECT name FROM people WHERE id = :id', { id: 1 });

// Una carga masiva en un solo viaje
await oracle.executeMany('INSERT INTO people (name) VALUES (:name)', [{ name: 'Ana' }, { name: 'Bea' }]);
```

Cada sentencia recibe opciones como último argumento: `{ timeout, signal, dropUnusedBinds, bindStyle, bindDialect }` (ver [Timeouts](#timeouts-y-cancelación)). Fuera de una transacción, cada sentencia hace commit sola.

Los binds van por nombre (`:id` y `{ id }`) o por posición (`:1`, `:2` y un array). **Los binds por posición siguen el orden en que aparecen sus placeholders en el SQL, no sus números**: en `WHERE b = :2 AND a = :1`, el primer valor va a `:2`. Preferí binds por nombre.

Un nombre de bind que es palabra reservada de Oracle (`uid`, `date`, `user`, `level`, `size`…) falla con ORA-01745, y Oracle no distingue mayúsculas en los nombres de bind, así que `{ id, ID }` es ambiguo: el driver rechaza ambos casos antes de mandar la sentencia. Un bind que el SQL no usa falla (NJS-097/NJS-098); con `dropUnusedBinds` (la opción, o la config) se descarta, útil cuando un mismo objeto de binds sirve a varias sentencias.

### Binds por posición (`bindStyle`)

Con `bindStyle: 'positional'` (en la config, o por sentencia) el driver compila los binds por nombre a binds por posición antes de correr la sentencia, así Oracle nunca ve un nombre de bind: un parámetro que el SQL no usa se descarta, una palabra reservada (`:date`, `:user`) y un nombre en otra capitalización (`:ID` para `{ id }`) funcionan, y un array se expande a una lista IN. El hook OnQuery sigue recibiendo el SQL como está escrito, y los OUT binds vuelven por nombre.

```typescript
const oracle = new OracleDriver(); // app.config.oracle = { …, bindStyle: 'positional' }

await oracle.query('SELECT * FROM pedidos WHERE id IN (:ids) AND fecha >= :date', { ids: [1, 2, 3], date, unused: 1 });
// corre: SELECT * FROM pedidos WHERE id IN (:1, :2, :3) AND fecha >= :4
```

`bindDialect: 'sqlx'` lee los placeholders como sqlx de Go, para SQL copiado de un servicio en Go: `::` es un dos puntos literal (`TO_CHAR(f, 'HH24::MI')`), los nombres coinciden exactamente, y se mantienen sus rarezas (un `?` se reescribe aun dentro de un literal). `compileNamed(sql, params, dialect)` hace lo mismo por separado.

### Una fila, páginas y filas tipadas

```typescript
import { col, rowSpec } from '@iskra-bun/db-oracle';

// Una especificación de fila: cada campo y el tipo de su columna; `idArea` lee ID_AREA.
const Usuario = rowSpec({
    id: col.int(),
    nombre: col.string(),
    activo: col.boolean(), // 'S'/'N', 1/0, 'Y'/'N' (un CHAR(1))
    idArea: col.int(),
    baja: col.date().nullable(),
});

const usuario = await oracle.one('SELECT * FROM usuarios WHERE id = :id', { id }, { rows: Usuario });
// NoRowsError (NOT_FOUND: un 404 en web-kit) cuando no hay ninguna

const page = await oracle.list({
    // Una función de los filtros y los órdenes; los conteos reciben orders = null.
    query: (filters, orders) => usuariosQuery(filters, orders), // { sql, params }
    filters: { area: 3 },
    orders: 'nombre',
    totalFilters: {}, // total cuenta sin los filtros del request
    offset: c.req.query('start'), // start y length de DataTables; o page/pageSize
    limit: c.req.query('length'),
    rows: Usuario,
});
// { rows, total, filtered, offset, limit, pages }
```

- `oracle.list()` recibe una función `query` (que se llama con los órdenes para las filas y con `null` para los conteos) o `sql` y `params` directos. Le agrega `OFFSET … FETCH NEXT` a la consulta de la página y cuenta con `SELECT COUNT(*) FROM (…)`; `count: 'none'` omite los conteos. Un `limit` -1 o null devuelve todas las filas (hasta `maxLimit`, si está); un `offset` o `limit` inválido del request es un `QueryInputError` (400). Su resultado va tal cual a `list(c, page)` de web-kit.
- Una especificación de fila convierte cada columna: `col.int()` (un entero dentro de 2^53, `col.bigint()` más allá), `col.number()`, `col.string()` (un NUMBER como decimal plano, un DATE como ISO 8601), `col.boolean()`, `col.date()`; `.nullable()` acepta NULL, `.from('COLUMNA')` nombra otra columna. Un NULL en un campo que no es nullable, o un valor que no se convierte, es un `RowDecodeError` que nombra la columna pero no el valor. `rowSpec(spec, { extra: 'ignore' | 'keep' | 'error', missing: 'undefined' | 'zero' | 'error' })` decide qué pasa con las columnas que la especificación no nombra y con los campos cuya columna falta (`'error'` y `'zero'` como sqlx de Go). `rows` también acepta un Standard Schema (Zod 3.24+).
- Con `fetchAsString: ['number']` los NUMBER llegan como texto, exactos más allá de 2^53, y `col.bigint()` los mantiene así.
- `query()`, `queryOne()`, `one()` y `list()` aceptan `rows`. El driver y una transacción comparten una interfaz, `OracleSession`, para repositorios que reciben cualquiera de los dos (y un fake en los tests).

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

### Cargas masivas con tipos

`executeMany()` también acepta valores tipados, por ejemplo para cargar CLOBs de más de 32 KB, y binds `RETURNING INTO` en `bindDefs`:

```typescript
const { rowsAffected, outBinds } = await oracle.executeMany(
    'INSERT INTO docs (name, body) VALUES (:name, :body) RETURNING id INTO :id',
    docs.map((d) => ({ name: d.name, body: { type: 'clob', val: d.text } })),
    { bindDefs: { id: { dir: 'returning', type: 'number' } } },
);
outBinds; // [{ id: [41] }, { id: [42] }, …]: uno por fila
```

Cuando se nombra un tipo, node-oracledb necesita la definición de todos los binds: los demás se infieren de las filas, y los strings y RAW toman el tamaño del valor más largo.

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

El dialecto genera SQL que corre en todas las versiones, y rechaza al compilar, diciendo qué usar en su lugar, lo que Oracle no tiene:

- Un select sin FROM (`selectNoFrom`) lee `FROM DUAL`, obligatorio antes de 23ai.
- Un `mergeInto()` pone la condición del `ON` entre paréntesis, como exige Oracle. El MERGE de Oracle acepta solo `whenMatched().thenUpdateSet()` y `whenNotMatched().thenInsertValues()`: `whenMatchedAnd()`, `thenDelete()` y `thenDoNothing()` se rechazan.
- Con `compatibility: '19c'` (el default), un valor boolean en SQL y un INSERT de varias filas con VALUES se rechazan: los dos existen recién desde 23ai. Usá 1/0 o 'Y'/'N', y `executeMany()` o un insert por fila. Con `'23ai'` se permiten (el driver avisa si la base es más vieja).
- `returning()` (usá `execute()` con binds `dir: 'returning'`), `onConflict()` y `onDuplicateKeyUpdate()` (usá `mergeInto()`), y `limit()` en un UPDATE o DELETE.

Tampoco se soporta con Kysely: el `Migrator` de Kysely (usá [`runMigrations()`](#migraciones)) ni la introspección.

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

Dentro de `transaction(fn)`, `oracle.query()`, `oracle.execute()`, `oracle.db` y el resto también corren en la transacción, sobre su conexión: otra conexión que tocara las filas bloqueadas por la transacción las esperaría para siempre, un bloqueo que Oracle no detecta como deadlock. Oracle no tiene transacciones anidadas: `transaction()` dentro de otra lanza un error. Dentro de `oracle.db.transaction()` de Kysely, usá su `trx`: `oracle.*` no se une a ella.

## Paginación, búsqueda y orden

```typescript
import { search, sortBy } from '@iskra-bun/db-oracle';
import { defineRoute } from '@iskra-bun/web-kit';

defineRoute({
    method: 'GET',
    path: '/people',
    handler: async (ctx) => {
        const param = (name: string) => ctx.raw.req.query(name);
        let q = oracle.db!.selectFrom('PEOPLE').select(['ID', 'NAME', 'CITY']);
        q = search(q, ['NAME', 'CITY'], param('q'));
        q = sortBy(q, param('sort'), ['NAME', 'CITY']).orderBy('ID');
        return oracle.paginate(q, { page: param('page'), pageSize: param('pageSize') });
    },
});
// → { items, total, page, pageSize, pages }
```

- **`oracle.paginate(query, { page, pageSize })`** (o `paginate(db, query, options)` con el `db` de una transacción) trae la página con `OFFSET … FETCH NEXT` y un conteo de toda la consulta. La página y su tamaño pueden ser strings de un query string; un valor inválido vuelve al default, y el tamaño tiene un tope `maxPageSize` (default 100). La consulta necesita un `orderBy` que termine en una columna única: sin él Oracle devuelve las filas en cualquier orden, y las páginas repetirían o saltearían filas.
- **`paginateByCursor(query, { keys, after, pageSize, direction })`** pagina por claves (keyset): una página profunda no cuesta más que la primera, y las filas insertadas mientras tanto no corren las páginas. Ordena por `keys`, que tienen que estar seleccionadas, no ser NULL y ser únicas en conjunto (terminá con la clave primaria), y devuelve `{ items, nextCursor }`. Pasá `nextCursor` como `after` para la página siguiente; en la última es null. Declará una clave DATE o TIMESTAMP como `{ key: 'CREATED', type: 'timestamp' }`: el cursor lleva entonces su texto con los nueve dígitos fraccionarios, porque un Date de JS guarda milisegundos y un TIMESTAMP(6) microsegundos, y se repetirían o saltearían filas. Una clave de fecha sin declarar así lanza un error.
- **`search(query, columns, term)`** deja las filas donde alguna de `columns` contiene `term`, sin distinguir mayúsculas (`upper(col) like :term escape '\'`). El término es un bind, y sus `%` y `_` se buscan literalmente. Un término vacío deja la consulta como está.
- **`sortBy(query, sort, allowed)`** ordena por un parámetro como `name,-created` (`-` para descendente), aceptando solo los campos de `allowed`. Agregá una columna única después para desempatar.

Un cursor mal formado o un campo fuera de `allowed` lanza un `QueryInputError` (código `VALIDATION_ERROR`). Viene del cliente: web-kit lo responde 400 con su mensaje (está marcado `expose`); en otro lado, respondé 400 vos.

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
- Un PL/SQL que no compila igual se crea, inválido: node-oracledb lo avisa como warning (NJS-700), no como error. `runMigrations()` hace fallar el archivo con los errores de `USER_ERRORS` (`PROCEDURE P (line 3, column 5: PLS-00201: …)`) y no lo registra.
- Las sentencias de un archivo y su registro hacen commit juntos, pero **Oracle hace commit de cada sentencia DDL por su cuenta**: un archivo que falla a mitad de camino conserva el DDL anterior a la falla, y su DML desde el último DDL se revierte. Separá el DDL y los cambios de datos en archivos distintos, y escribí DDL que se pueda volver a correr (o arreglalo a mano) cuando un archivo falla.

## Timeouts y cancelación

Cada sentencia corre con `callTimeout` (30 s por defecto): pasado ese tiempo, node-oracledb cancela la sentencia en la base y falla con un `QueryError` NJS-123, o, cuando la base no toma esa cancelación, el driver la abandona al llegar a su [plazo](#el-plazo); en los dos casos su conexión se descarta del pool. Si no, una sentencia que espera un lock de fila no terminaría nunca y retendría su conexión; con el pool por defecto de 4, unas pocas así frenan el servicio entero. Fijá el límite por sentencia, o cancelá con un `AbortSignal` (la sentencia falla con ORA-01013):

```typescript
await oracle.execute('UPDATE accounts SET balance = :b WHERE id = :id', binds, { timeout: 2000 });

const controller = new AbortController();
setTimeout(() => controller.abort(), 1000);
await oracle.query(reportSql, [], { signal: controller.signal, timeout: 0 });

await oracle.db!.selectFrom('PEOPLE').selectAll().execute({ signal: controller.signal });
```

`timeout: 0` quita el límite (un reporte, una exportación). Las migraciones corren sin él: crear un índice puede tardar. La espera de una conexión libre la acota `pool.queueTimeout` (NJS-040).

### El plazo

En modo Thin, node-oracledb cancela una llamada mandándole a la base un break por la misma conexión, y una sesión que espera un lock de fila no lo lee: entonces `callTimeout` nunca termina esa espera, un `AbortSignal` tampoco, y la llamada y su conexión quedan tomadas para siempre. Por eso el driver no depende sólo de eso. Cada llamada (una sentencia, cada fetch de un stream, un commit o un rollback) tiene un **plazo**: su timeout más `deadlineGrace` (por defecto el mismo timeout, hasta 5 s: un timeout de 30 s abandona a los 35 s, uno de 1 s a los 2 s). Pasado el plazo:

- la llamada falla con un `DeadlineError` (un `QueryError` con `deadlineMs`);
- el driver cierra el socket de la conexión, así node-oracledb la suelta y sale del pool en el momento (con versiones o modos de node-oracledb donde no puede, le pide a node-oracledb que la cancele y descarta la conexión cuando la llamada termina);
- en una transacción, la transacción se pierde: las sentencias siguientes y el commit fallan sin correr, y `transaction()` relanza el error.

Un abort funciona igual: si la sentencia no se detuvo `deadlineGrace` (1 s por defecto) después de la señal, el driver abandona su conexión y la sentencia falla con ORA-01013.

:::caution
Abandonar no frena a la base. Una sesión que espera un lock sigue esperando después de que se cierra su socket, y corre la sentencia cuando el lock se libera: fuera de una transacción, donde cada sentencia se confirma sola, **la sentencia puede aplicarse igual**. En una transacción no puede: la sesión muere cuando intenta responder y la base hace rollback de la transacción. Corré dentro de `transaction()` lo que no debe aplicarse tarde.
:::

Una llamada sin timeout (`timeout: 0`, las migraciones) no tiene plazo. `error.timedOut` es `true` tanto para NJS-123 como para un `DeadlineError`. El plazo cuenta la llamada entera, así que una consulta que trae muchas filas en muchas idas y vueltas necesita un `timeout` que la cubra completa. Las sentencias de una misma transacción corren de a una (node-oracledb las encolaría igual), cada una con su propio timeout.

## Readiness y observabilidad

```typescript
import { HealthCheckFeature } from '@iskra-bun/web-kit';

const health = new HealthCheckFeature();
health.addReadinessCheck('oracle', () => oracle.ping());

// Cada sentencia (cruda y de Kysely) y sus binds; un callback que lanza se ignora
oracle.setOnQuery((sql, binds) => app.logger.debug({ sql }, 'oracle query'));
```

El callback puede devolver una función, que se llama al terminar la sentencia con `{ durationMs, rows, rowsAffected, error }`: el fin de un span de trazas. Un stream la llama una vez, con todas las filas que entregó.

```typescript
import { trace, SpanStatusCode } from '@opentelemetry/api';

const tracer = trace.getTracer('oracle');
oracle.setOnQuery((sql) => {
    const span = tracer.startSpan('oracle.query', { attributes: { 'db.system': 'oracle', 'db.statement': sql } });
    return ({ rows, rowsAffected, error }) => {
        span.setAttributes({ 'db.rows': rows ?? rowsAffected ?? 0 });
        if (error) span.setStatus({ code: SpanStatusCode.ERROR, message: error.errorCode });
        span.end();
    };
});
```

Los binds pueden tener datos personales: registralos solo donde eso sea aceptable.

## Errores

| Error | Cuándo |
|---|---|
| `ConnectionError` | `start()` no pudo abrir el pool ni llegar a la base. Su mensaje trae el de Oracle (`ORA-01017: …`); su contexto, el connect string y el usuario, nunca la contraseña. |
| `QueryError` | Falló una sentencia. `error.errorCode` es el código de la base o del driver, y `error.errorNum` el número ORA; el error original es `cause`. Su `code` le dice a web-kit cómo responder: `CONFLICT` (409) para `ORA-00001` (restricción única), `SERVICE_UNAVAILABLE` (503) para `NJS-040` (sin conexión libre dentro de `pool.queueTimeout`), `TIMEOUT` (504) para `NJS-123` (se pasó el `callTimeout`), `QUERY_ERROR` (500) si no; el mensaje queda en el log. `error.timedOut` es `true` para NJS-123 y para un `DeadlineError`. Un `RAISE_APPLICATION_ERROR` de PL/SQL (ORA-20000 a ORA-20999) es un `CONFLICT` (409) cuyo mensaje es el del procedimiento, sin `ORA-20xxx:` ni el stack, y se muestra al cliente; `error.applicationError` tiene su número y su mensaje. |
| `DeadlineError` | Un `QueryError`: una llamada pasó su [plazo](#el-plazo) y el driver abandonó su conexión. `error.deadlineMs` es el plazo; su código es `TIMEOUT` (504). |
| `MigrationError` | Falló una migración (su contexto nombra el archivo y la sentencia), cambió después de aplicarse, o venció la espera del lock. |
| `QueryInputError` | Un cursor de paginación, un campo de orden, un `offset` o un `limit` del request no es válido: web-kit responde 400 con su mensaje. |
| `NoRowsError` | `one()` no encontró ninguna fila: un `QueryError` con código `NOT_FOUND` (404). |
| `RowDecodeError` | Una fila no encaja en su especificación o schema: un `QueryError` (500) que nombra la columna, no el valor. |
| `ConfigError` (core) | `app.config.oracle` no es válida. |

## Actualizar desde 0.1

La 0.1 corría las consultas a través de un proceso Node (`bridge/runner.js`).

- Ya no hay puente: no hace falta `node`, y `oracledb` es una dependencia del paquete (no se instala aparte).
- `new OracleDriver()` no recibe argumentos: la ruta del puente y los timeouts ya no existen (usá `pool.queueTimeout`). La conexión sale de `app.config.oracle`, o todavía de `ORA_CONN`, `ORA_USER` y `ORA_PASSWORD`.
- `query(sql, params)` sigue devolviendo las filas, y una sentencia sigue haciendo commit sola; para sentencias que hacen commit o rollback juntas, usá `transaction()`.
- El `name` del driver es `'OracleDriver'` (era `'db'`, igual que el `DbDriver` de db-kit).
- Los errores son `QueryError` con el número ORA en vez de `Error` comunes.
