---
title: KV Kit
description: Key-value store with support for Redis and memory.
---

Key-value store with support for Redis and memory.

## Quick Start

```typescript
import { App } from '@iskra-bun/core';
import { KVManager } from '@iskra-bun/kv-kit';

const app = new App({
    name: 'MiApp',
    kv: {
        driver: 'redis',
        connection: { url: 'redis://localhost:6379' },
    },
});

const kv = new KVManager();
app.register(kv);

await app.start();

// Usar el store
await kv.set('usuario:123', { name: 'Juan', role: 'admin' });
const user = await kv.get('usuario:123');
await kv.del('usuario:123');
```

## Adapters

### Memory (default)

If you do not configure anything, it uses the memory adapter:

```typescript
const app = new App({ name: 'MiApp' });
const kv = new KVManager(); // usa memoria por defecto
```

### Redis

`connection` is passed straight to the `ioredis` client, so it accepts either an options object (`RedisOptions`) or a connection string:

```typescript
const app = new App({
    name: 'MiApp',
    kv: {
        driver: 'redis',
        connection: { url: process.env.REDIS_URL || 'redis://localhost:6379' },
    },
});

// Or a connection string:
const app = new App({
    name: 'MiApp',
    kv: { driver: 'redis', connection: 'redis://localhost:6379' },
});
```

`app.start()` waits for Redis to answer, so an unreachable server or a wrong password fails the start instead of the first command. Once connected, a dropped connection is retried by ioredis, and its connection errors go to the app's logger (`warn`).

## API

```typescript
// Store (with optional TTL in seconds)
await kv.set('key', value);
await kv.set('key', value, 60); // expires in 60 seconds

// Retrieve — returns undefined when the key does not exist
const data = await kv.get('key');

// Delete
await kv.del('key');

// Check existence
const exists = await kv.has('key');

// Delete every key of the namespace (see "Clearing keys")
await kv.clear();
```

### Native Redis client

With the `redis` driver, `kv.client` is the [ioredis](https://github.com/redis/ioredis)
client (after `app.start()`) for commands the KV API does not cover (sets, sorted sets,
pipelines). It bypasses `namespace` and the JSON codec. It is `undefined` with the
`memory` driver. The `KVManager` is also registered in the app context:

```typescript
const kv = app.context.get('kv'); // the KVManager
await kv.client?.sadd('tags', 'a', 'b');
```

## Generic (Typed) Values

`get` and `set` accept a type parameter so you get typed reads instead of `any`:

```typescript
interface User {
    name: string;
    role: string;
}

// Typed write
await kv.set<User>('user:123', { name: 'Juan', role: 'admin' });

// Typed read — resolves to User | undefined
const user = await kv.get<User>('user:123');
if (user) {
    console.log(user.role); // string, not any
}
```

A missing key resolves to `undefined` (not `null`). Previously the Redis adapter could return `null` for missing keys; this is now normalised across all adapters.

## Redis Value Codec

The Redis adapter uses a single consistent codec for every write and read: values are serialised with `JSON.stringify` on write and parsed with `JSON.parse` on read. Strings, numbers, booleans, and plain objects and arrays of them keep their types:

```typescript
await kv.set('numeric', '123'); // string
typeof (await kv.get('numeric')); // 'string' — NOT coerced to the number 123

await kv.set('jsonish', '{}');    // string
await kv.get('jsonish');          // '{}' — still a string, NOT an empty object

await kv.set('count', 42);        // number
typeof (await kv.get('count'));   // 'number'
```

`undefined` is handled explicitly (stored as the JSON `null` literal and decoded back to `undefined`), so it can never be corrupted into the string `"undefined"`. Values written outside the adapter that are not valid JSON are returned as-is (as a string).

Anything JSON cannot represent does **not** round-trip, unlike with the in-memory adapter, which keeps a copy of the value itself: a `Date` comes back as an ISO string, a `Map` or `Set` as `{}`, `undefined` inside an array as `null`, and `null` as `undefined`. Convert such values yourself (`date.toISOString()` / `new Date(s)`, `Object.fromEntries(map)`).

## Namespace

Pass a `namespace` option to transparently prefix every key and prevent collisions between modules that share the same store:

```typescript
const sessions = new KVManager({ namespace: 'sessions' });
const cache    = new KVManager({ namespace: 'cache' });

// These write to "sessions:token" and "cache:token" — no collision
await sessions.set('token', sessionData);
await cache.set('token', cachedResponse);
```

The prefix is applied automatically; you never include it in your key strings. The option defaults to `""` (no prefix) so existing code is unaffected.

## Clearing keys

`kv.clear(prefix?)` deletes every key of the manager's namespace (only those under `prefix` within it, when given), and never touches the connection:

- Memory: the matching keys are deleted.
- Redis: the keys are found with `SCAN` and deleted with `DEL`, scoped to the namespace (and to ioredis' `keyPrefix`, if you set one). Without a namespace, `clear()` would empty the whole Redis database, which other apps or services may share, so it throws unless you opt in with `flushDb: true`, which runs `FLUSHDB`:

```typescript
const cache = new KVManager({ namespace: 'cache' });
await cache.clear(); // deletes cache:* only

const owned = new KVManager({ flushDb: true }); // this app owns the database
await owned.clear(); // FLUSHDB
```

cache-kit's `clear()` runs this `clear()`, so a `Cache` on a `KVManager` clears its own keys.

## Expiring sets

`sadd(key, member, ttl?)` and `sdrain(key)` keep a set of strings whose members expire one by one: the set lives as long as its longest-lived member, and `sdrain` deletes it and returns its members in one step. With Redis it is a sorted set scored by expiry, updated by one atomic script. cache-kit keeps its tag index in them. Only `key` is namespaced; members are stored as given.

## Batch Operations

`KVManager` exposes three batch helpers that run their underlying calls concurrently:

```typescript
// Read multiple keys at once — order-preserving, undefined for missing keys
const [a, b, c] = await kv.mget<string>(['key:a', 'key:b', 'key:c']);

// Write multiple key/value pairs (optional shared TTL)
await kv.mset({ 'key:a': 'alpha', 'key:b': 'beta' });
await kv.mset([['key:c', 'gamma'], ['key:d', 'delta']], 120); // TTL = 120 s

// Delete multiple keys
await kv.mdel(['key:a', 'key:b', 'key:c']);
```

`mset` accepts either an array of `[key, value]` tuples or a plain object.

## TTL and the Memory Adapter

A TTL is a number of seconds; `0` (or none) means no expiry, and a negative or non-finite TTL is rejected with a `RangeError`.

The in-memory adapter manages expiry timers without leaks: overwriting a key with a new `set` call cancels any previous timer before scheduling the new one, so a stale timer can never delete a freshly written value. TTLs longer than `setTimeout`'s limit (about 24.8 days) are supported.

Like Redis, the in-memory adapter stores and returns copies (`structuredClone`): changing an object you passed to `set`, or one `get` returned, does not change the stored value (it used to be the same object, so one request's change showed up in every other). A value that cannot be cloned, such as a function, is rejected; a class instance comes back as a plain object.

## Environment Variables

```bash
REDIS_URL=redis://localhost:6379
```
