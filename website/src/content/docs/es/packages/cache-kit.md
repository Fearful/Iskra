---
title: Cache Kit
description: Cache de aplicación de alto nivel para Iskra, construido sobre kv-kit.
---

Cache de aplicación de alto nivel para Iskra, construido sobre `@iskra-bun/kv-kit`.

## Inicio Rapido

```typescript
import { Cache } from '@iskra-bun/cache-kit';

// Sin configuración — usa un adaptador en memoria por defecto (ideal para dev/tests)
const cache = new Cache();

await cache.set('user:1', { name: 'Alice', role: 'admin' });
const user = await cache.get('user:1');
await cache.delete('user:1');
```

## Constructor

```typescript
new Cache(adapter?, options?)
```

| Parámetro | Tipo | Descripción |
|-----------|------|-------------|
| `adapter` | `KVAdapter` | Un `KVManager` de kv-kit (driver de memoria o Redis), o cualquier `KVAdapter`. Opcional — por defecto usa un adaptador en memoria. |
| `options.namespace` | `string` | Prefijo global que se añade a cada clave en esta instancia. |
| `options.defaultTtl` | `number` | TTL por defecto en segundos cuando se llama a `set()` sin uno explícito. |

## API Principal

```typescript
// Leer
const value = await cache.get<User>('user:1');     // undefined si no existe

// Escribir
await cache.set('user:1', { name: 'Alice' });
await cache.set('user:1', data, 300);              // atajo ttl=300s
await cache.set('user:1', data, { ttl: 300, tags: ['users'] });

// Verificar existencia
const exists = await cache.has('user:1');

// Eliminar
await cache.delete('user:1');

// Elimina todas las entradas de esta cache (su namespace y los que cuelgan de él)
await cache.clear();
```

`clear()` ejecuta el `clear()` del adaptador con el namespace de la cache: una
cache con namespace borra solo sus entradas e índices de etiquetas, y una cache raíz
todas las claves del adaptador. Nunca recicla la conexión (antes hacía
`disconnect()`/`connect()` del adaptador compartido: en Redis no borraba nada, y una
reconexión fallida dejaba el adaptador muerto). Sobre un `KVManager` borra el
namespace del manager con `SCAN` + `DEL`; una cache raíz sobre un `KVManager` de
Redis sin namespace vaciaría toda la base, así que lanza un error salvo que el
manager tenga `flushDb: true`. Un adaptador sin `clear()` hace que lance un error.

Un valor con una clave `__proto__`, `constructor` o `prototype` (a cualquier
profundidad) nunca se devuelve: `set()` no guarda nada (y borra el valor anterior
de la clave), y `get()` trata uno escrito por otro como un miss y lo borra, así que
`remember()` vuelve a llamar al fallback. Antes se guardaba y luego cada lectura
lanzaba un error hasta que vencía su TTL.

Las claves y los namespaces no pueden contener `__cache_tag__:` ni `__cache_tags__:`
al principio o después de un `:`: ahí viven los índices de etiquetas, y una clave
como `__cache_tag__:perms` permitía reescribir el índice, así que
`invalidateTag('perms')` borraba lo que listara. Esas claves lanzan un error.

## Cache-Aside: remember() / wrap()

```typescript
// Llama al fallback solo en un cache miss; almacena el resultado con el TTL dado
const data = await cache.remember('dashboard:stats', 60, async () => {
    return db.query('SELECT ...');
});

// wrap() es un alias de remember()
const data2 = await cache.wrap('dashboard:stats', 60, () => db.query('...'));
```

El fallback se llama **exactamente una vez** por cache miss — nunca en un hit. Un error que lance llega tal cual a quien llama (misma clase, `status` o `code`), y no se guarda nada.

## Namespacing

```typescript
const users = cache.namespace('users');
const posts = cache.namespace('posts');

// 'users:profile:1' y 'posts:profile:1' son claves distintas
await users.set('profile:1', userPayload);
await posts.set('profile:1', postPayload);

// Los namespaces se apilan
const admin = users.namespace('admin'); // prefijo efectivo: 'users:admin'
```

## Invalidación por Etiquetas

```typescript
await cache.set('item:1', item1, { ttl: 60, tags: ['items', 'featured'] });
await cache.set('item:2', item2, { ttl: 60, tags: ['items'] });
await cache.set('banner', banner, { ttl: 60, tags: ['featured'] });

await cache.invalidateTag('items');
// item:1 e item:2 eliminados; banner no se toca

await cache.invalidateTag('featured');
// banner eliminado
```

Cada etiqueta guarda un índice de sus claves en el almacenamiento, que vive lo que
la entrada más duradera que contiene:

- Con un `KVManager` (cualquier driver) o el adaptador por defecto, es el set con
  expiración de kv-kit (`sadd`/`sdrain`; un sorted set en Redis): etiquetar una
  clave es un solo paso atómico sea cual sea el tamaño del índice, las claves
  vencidas se quitan de él, e instancias que comparten Redis no pueden pisarse.
- Con un adaptador sin esos métodos, es una lista JSON que se reescribe bajo un
  lock por proceso (así que instancias que comparten un store todavía pueden
  pisarse): las claves vencidas se quitan en cada escritura, y pasadas las 10.000
  entradas se eliminan las más antiguas junto con sus datos.

Si falla la indexación de una etiqueta (el almacén da error), `set()` borra la entrada que acaba de escribir y rechaza con ese error, así que no queda ninguna entrada que `invalidateTag()` no alcance.

Los índices escritos antes de esta versión (una lista JSON por etiqueta) se siguen
leyendo y borrando en `invalidateTag()`.

## Uso con KVManager (producción)

```typescript
import { App } from '@iskra-bun/core';
import { KVManager } from '@iskra-bun/kv-kit';
import { Cache } from '@iskra-bun/cache-kit';

const app = new App({
    name: 'MyApp',
    kv: { driver: 'redis', connection: { url: process.env.REDIS_URL } },
});

// Un namespace para las claves de la cache: clear() borra entonces solo cache:*.
const kv = new KVManager({ namespace: 'cache' });
app.register(kv);
await app.start();

const cache = new Cache(kv, { defaultTtl: 300 });
```
