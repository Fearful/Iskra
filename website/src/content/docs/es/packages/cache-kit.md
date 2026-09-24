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
| `adapter` | `KVAdapter` | Cualquier adaptador de kv-kit (MemoryAdapter, RedisAdapter, KVManager). Opcional — por defecto usa MemoryAdapter. |
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

// Vacía todo el backing store (solo en la cache raíz — ver advertencia abajo)
await cache.clear();
```

> **Advertencia — `clear()` reinicia todo el store, no es por namespace.** Recicla
> el adaptador (`disconnect()`/`connect()`), borrando **todas** las claves del
> backing store compartido por esta cache y cualquier otra `Cache` construida sobre
> el mismo adaptador — en todos los namespaces. Para evitar que una sub-cache con
> namespace vacíe silenciosamente a sus hermanas, `clear()` **lanza un error** cuando
> hay un prefijo de namespace; solo es válido en una `Cache` raíz. Para limpiar un
> único namespace, elimina claves individualmente con `delete()` o invalida un grupo
> con `invalidateTag()`.

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

Cada etiqueta guarda un índice de sus claves en el almacenamiento. Sus actualizaciones se serializan dentro de un proceso, pero instancias que comparten un Redis todavía pueden pisarse, así que una clave etiquetada en el mismo momento en otra instancia puede sobrevivir a un `invalidateTag()`. El índice no tiene TTL: solo lo borra `invalidateTag()`, así que una etiqueta que nunca se invalida crece con cada clave que la usa.

## Uso con RedisAdapter (producción)

```typescript
import { RedisAdapter } from '@iskra-bun/kv-kit';
import { Cache } from '@iskra-bun/cache-kit';

const adapter = new RedisAdapter({ url: process.env.REDIS_URL });
adapter.connect();

const cache = new Cache(adapter, { namespace: 'myapp' });
```

## Uso con KVManager

```typescript
import { App } from '@iskra-bun/core';
import { KVManager } from '@iskra-bun/kv-kit';
import { Cache } from '@iskra-bun/cache-kit';

const app = new App({
    name: 'MyApp',
    kv: { driver: 'redis', connection: { url: process.env.REDIS_URL } },
});

const kv = new KVManager();
app.register(kv);
await app.start();

const cache = new Cache(kv, { namespace: 'myapp', defaultTtl: 300 });
```
