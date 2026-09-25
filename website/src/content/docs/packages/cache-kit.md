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
| `adapter` | `KVAdapter` | A kv-kit `KVManager` (memory or Redis driver), or any `KVAdapter`. Optional — defaults to an in-memory adapter. |
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

// Delete every entry of this cache (its namespace, and the ones under it)
await cache.clear();
```

`clear()` runs the adapter's `clear()` with the cache's namespace: a namespaced
cache deletes its own entries and tag indexes only, a root cache every key of the
adapter. It never recycles the connection (it used to `disconnect()`/`connect()`
the shared adapter: on Redis that deleted nothing, and a failed reconnect left the
adapter dead). On a `KVManager` it deletes the manager's namespace with `SCAN` +
`DEL`; a root cache on a Redis `KVManager` without a namespace would empty the
whole database, so it throws unless the manager has `flushDb: true`. An adapter
without `clear()` makes it throw.

A value with a `__proto__`, `constructor` or `prototype` key (at any depth) is
never returned: `set()` stores nothing for it (and deletes the key's old value),
and `get()` treats one written by someone else as a miss and deletes it, so
`remember()` calls the fallback again. It used to be stored, then every read
threw until its TTL ran out.

Keys and namespaces may not contain `__cache_tag__:` or `__cache_tags__:` at their
start or after a `:`: that is where tag indexes live, and a key such as
`__cache_tag__:perms` let a caller rewrite the index, so `invalidateTag('perms')`
deleted whatever it listed. Such keys throw.

## Cache-Aside: remember() / wrap()

```typescript
// Calls the fallback only on a cache miss; stores the result with the given TTL
const data = await cache.remember('dashboard:stats', 60, async () => {
    return db.query('SELECT ...');
});

// wrap() is an alias for remember()
const data2 = await cache.wrap('dashboard:stats', 60, () => db.query('...'));
```

The fallback is called **exactly once** per cache miss — never on a hit. An error it throws reaches the caller as is (same class, `status` or `code`), and nothing is cached.

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

Each tag keeps an index of its keys in the backing store, which lives as long as
the longest-lived entry in it:

- With a `KVManager` (either driver) or the default adapter, it is kv-kit's
  expiring set (`sadd`/`sdrain`; a sorted set on Redis): tagging a key is one atomic
  step whatever the size of the index, expired keys are dropped from it, and
  instances sharing Redis cannot race on it.
- With an adapter without those methods, it is a JSON list rewritten under a
  per-process lock (so instances sharing a store can still race on it): expired
  keys are dropped on each write, and past 10,000 entries the oldest ones are
  deleted along with their data.

Indexes written before this version (a JSON list per tag) are still read and
deleted by `invalidateTag()`.

## Using with KVManager (production)

```typescript
import { App } from '@iskra-bun/core';
import { KVManager } from '@iskra-bun/kv-kit';
import { Cache } from '@iskra-bun/cache-kit';

const app = new App({
    name: 'MyApp',
    kv: { driver: 'redis', connection: { url: process.env.REDIS_URL } },
});

// A namespace for the cache's keys: clear() then deletes cache:* only.
const kv = new KVManager({ namespace: 'cache' });
app.register(kv);
await app.start();

const cache = new Cache(kv, { defaultTtl: 300 });
```
