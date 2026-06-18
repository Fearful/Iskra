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
// Guardar (con TTL opcional en segundos)
await kv.set('clave', valor);
await kv.set('clave', valor, 60); // expira en 60 segundos

// Obtener
const data = await kv.get('clave');

// Eliminar
await kv.del('clave');

// Verificar existencia
const existe = await kv.has('clave');
```

## Environment Variables

```bash
REDIS_URL=redis://localhost:6379
```
