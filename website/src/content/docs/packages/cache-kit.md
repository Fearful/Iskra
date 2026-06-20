---
title: Cache Kit
description: Higher-level application cache for Iskra, built on top of kv-kit.
---

Higher-level application cache for Iskra, built on top of `@iskra-bun/kv-kit`.

## Quick Start

```typescript
import { Cache } from '@iskra-bun/cache-kit';

// Zero-config — defaults to an in-memory adapter (great for dev/tests)
const cache = new Cache();

await cache.set('user:1', { name: 'Alice', role: 'admin' });
const user = await cache.get('user:1');
await cache.delete('user:1');
```

## Constructor

```typescript
new Cache(adapter?, options?)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `adapter` | `KVAdapter` | Any kv-kit adapter (MemoryAdapter, RedisAdapter, KVManager). Optional — defaults to MemoryAdapter. |
| `options.namespace` | `string` | Global prefix prepended to every key in this instance. |
| `options.defaultTtl` | `number` | Default TTL in seconds when `set()` is called without an explicit one. |

## Core API

```typescript
// Read
const value = await cache.get<User>('user:1');     // undefined if missing

// Write
await cache.set('user:1', { name: 'Alice' });
await cache.set('user:1', data, 300);              // shorthand ttl=300s
await cache.set('user:1', data, { ttl: 300, tags: ['users'] });

// Existence check
const exists = await cache.has('user:1');

// Remove
await cache.delete('user:1');

// Flush everything
await cache.clear();
```

## Cache-Aside: remember() / wrap()

```typescript
// Calls the fallback only on a cache miss; stores the result with the given TTL
const data = await cache.remember('dashboard:stats', 60, async () => {
    return db.query('SELECT ...');
});

// wrap() is an alias for remember()
const data2 = await cache.wrap('dashboard:stats', 60, () => db.query('...'));
```

The fallback is called **exactly once** per cache miss — never on a hit.

## Namespacing

```typescript
const users = cache.namespace('users');
const posts = cache.namespace('posts');

// 'users:profile:1' and 'posts:profile:1' are distinct keys
await users.set('profile:1', userPayload);
await posts.set('profile:1', postPayload);

// Namespaces stack
const admin = users.namespace('admin'); // effective prefix: 'users:admin'
```

## Tag-Based Invalidation

```typescript
await cache.set('item:1', item1, { ttl: 60, tags: ['items', 'featured'] });
await cache.set('item:2', item2, { ttl: 60, tags: ['items'] });
await cache.set('banner', banner, { ttl: 60, tags: ['featured'] });

await cache.invalidateTag('items');
// item:1 and item:2 deleted; banner is untouched

await cache.invalidateTag('featured');
// banner deleted
```

## Using with RedisAdapter (production)

```typescript
import { RedisAdapter } from '@iskra-bun/kv-kit';
import { Cache } from '@iskra-bun/cache-kit';

const adapter = new RedisAdapter({ url: process.env.REDIS_URL });
adapter.connect();

const cache = new Cache(adapter, { namespace: 'myapp' });
```

## Using with KVManager

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
