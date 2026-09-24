# @iskra-bun/cache-kit

Cache de aplicación de alto nivel para Iskra, construido sobre `@iskra-bun/kv-kit`.

## Instalacion

```bash
bun add @iskra-bun/cache-kit @iskra-bun/kv-kit @iskra-bun/core
```

## Uso rapido

```typescript
import { Cache } from '@iskra-bun/cache-kit';

// Zero-config — usa memoria en desarrollo
const cache = new Cache();

await cache.set('user:1', { name: 'Alice' }, { ttl: 300 });
const user = await cache.get('user:1');

// Cache-aside: llama al fallback solo en miss
const data = await cache.remember('dashboard', 60, () => fetchFromDB());
```

## Namespacing

```typescript
const users = cache.namespace('users');
const posts = cache.namespace('posts');

await users.set('profile:1', userPayload);
await posts.set('profile:1', postPayload); // clave distinta, sin colision
```

## Invalidacion por etiquetas

```typescript
await cache.set('item:1', item, { ttl: 60, tags: ['items', 'featured'] });
await cache.set('item:2', item2, { ttl: 60, tags: ['items'] });

await cache.invalidateTag('items'); // elimina item:1 e item:2
```

## Documentacion

Guia completa: [docs/cache-kit.md](../../docs/cache-kit.md)

## Licencia

AGPL-3.0-or-later
