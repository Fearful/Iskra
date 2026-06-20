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

```typescript
const app = new App({
    name: 'MiApp',
    kv: {
        driver: 'redis',
        connection: { url: process.env.REDIS_URL || 'redis://localhost:6379' },
    },
});
```

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

The in-memory adapter manages expiry timers without leaks: overwriting a key with a new `set` call cancels any previous timer before scheduling the new one, so a stale timer can never delete a freshly written value.

## Environment Variables

```bash
REDIS_URL=redis://localhost:6379
```
