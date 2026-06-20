# @iskra-bun/cache-kit

Cache de aplicacion de alto nivel para Iskra, construido sobre `@iskra-bun/kv-kit`.

## Inicio Rapido

```typescript
import { Cache } from '@iskra-bun/cache-kit';

// Sin configuracion — usa MemoryAdapter (perfecto para desarrollo/tests)
const cache = new Cache();

await cache.set('user:1', { name: 'Alice', role: 'admin' });
const user = await cache.get('user:1');
await cache.delete('user:1');
```

## Constructor

```typescript
new Cache(adapter?, options?)
```

| Parametro | Tipo | Descripcion |
|-----------|------|-------------|
| `adapter` | `KVAdapter` | Adaptador kv-kit (MemoryAdapter, RedisAdapter, KVManager). Opcional — por defecto usa MemoryAdapter. |
| `options.namespace` | `string` | Prefijo global para todas las claves de esta instancia. |
| `options.defaultTtl` | `number` | TTL en segundos aplicado cuando `set()` no recibe uno explicito. |

## API

```typescript
// Leer
const value = await cache.get<User>('user:1');     // undefined si no existe

// Escribir
await cache.set('user:1', { name: 'Alice' });
await cache.set('user:1', data, 300);              // shorthand ttl=300s
await cache.set('user:1', data, { ttl: 300, tags: ['users'] });

// Existencia
const exists = await cache.has('user:1');

// Eliminar
await cache.delete('user:1');

// Vacia todo el backing store (solo en la cache raiz — ver advertencia abajo)
await cache.clear();
```

> **Advertencia — `clear()` reinicia todo el store, no es por namespace.** Recicla
> el adaptador (`disconnect()`/`connect()`), borrando **todas** las claves del
> backing store compartido por esta cache y cualquier otra `Cache` construida sobre
> el mismo adaptador — en todos los namespaces. Para evitar que una sub-cache con
> namespace vacie silenciosamente a sus hermanas, `clear()` **lanza un error** cuando
> hay un prefijo de namespace; solo es valido en una `Cache` raiz. Para limpiar un
> unico namespace, elimina claves individualmente con `delete()` o invalida un grupo
> con `invalidateTag()`.

## Cache-aside: remember() / wrap()

```typescript
// Llama al fallback solo si la clave no esta en cache
const data = await cache.remember('dashboard:stats', 60, async () => {
    return db.query('SELECT ...');
});

// wrap() es un alias de remember()
const data2 = await cache.wrap('dashboard:stats', 60, async () => db.query('...'));
```

El fallback se llama **exactamente una vez** por miss — nunca en un hit. No hay deduplicacion de llamadas concurrentes: dos `remember()` que arranquen antes del primer `set()` veran ambos un miss y llamaran cada uno al fallback.

## Namespacing

```typescript
const users = cache.namespace('users');
const posts = cache.namespace('posts');

// 'users:profile:1' y 'posts:profile:1' son claves distintas
await users.set('profile:1', userPayload);
await posts.set('profile:1', postPayload);

// Los namespaces se pueden anidar
const admin = users.namespace('admin'); // prefijo: 'users:admin'
```

## Invalidacion por Etiquetas

```typescript
await cache.set('item:1', item1, { ttl: 60, tags: ['items', 'featured'] });
await cache.set('item:2', item2, { ttl: 60, tags: ['items'] });
await cache.set('banner', banner, { ttl: 60, tags: ['featured'] });

// Elimina todas las entradas con la etiqueta 'items'
await cache.invalidateTag('items');
// item:1 e item:2 eliminados; banner intacto

await cache.invalidateTag('featured');
// banner eliminado
```

## Usar con RedisAdapter (produccion)

```typescript
import { RedisAdapter } from '@iskra-bun/kv-kit';
import { Cache } from '@iskra-bun/cache-kit';

const adapter = new RedisAdapter({ url: process.env.REDIS_URL });
adapter.connect();

const cache = new Cache(adapter, { namespace: 'myapp' });
```

## Usar con KVManager

```typescript
import { App } from '@iskra-bun/core';
import { KVManager } from '@iskra-bun/kv-kit';
import { Cache } from '@iskra-bun/cache-kit';

const app = new App({
    name: 'MiApp',
    kv: { driver: 'redis', connection: { url: process.env.REDIS_URL } },
});

const kv = new KVManager();
app.register(kv);
await app.start();

const cache = new Cache(kv, { namespace: 'myapp', defaultTtl: 300 });
```
