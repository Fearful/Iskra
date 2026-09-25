---
title: Configuration
description: Iskra uses c12 to load configuration and Zod to validate it.
---

Iskra uses c12 to load configuration and Zod to validate it.

## Configuration File

Create an `app.config.ts` file at the root of your project:

```typescript
// app.config.ts
export default {
    name: 'MiApp',
    debug: false,
    logger: { level: 'info' },
    db: {
        driver: 'postgres',
        url: process.env.DATABASE_URL || 'postgres://localhost:5432/miapp',
    },
    kv: {
        driver: 'redis',
        connection: { url: process.env.REDIS_URL || 'redis://localhost:6379' },
    },
};
```

## Environment Variables

Iskra automatically loads `.env` files thanks to c12. It does not read `.apprc` files, and it loads `extends` layers only from local paths: remote sources (`github:`, `gitlab:`, `https://`) would be downloaded and run on every start.

Create a `.env` in your project:

```bash
# .env
NODE_ENV=development
PORT=3000
DATABASE_URL=postgres://user:pass@localhost:5432/miapp
REDIS_URL=redis://localhost:6379
```

And use the variables in your config:

```typescript
export default {
    web: { port: Number(process.env.PORT) || 3000 },
    db: { driver: 'postgres', url: process.env.DATABASE_URL },
};
```

## Validation with Zod

You can define a schema to validate the config at runtime:

```typescript
import { z } from 'zod';

export const AppConfigSchema = z.object({
    web: z.object({
        port: z.number().default(3000),
        cors: z.boolean().default(true),
    }),
    db: z.object({
        driver: z.enum(['postgres', 'mysql', 'sqlite']),
        url: z.string(),
    }),
    cache: z.object({
        adapter: z.enum(['memory', 'redis']).default('memory'),
        ttl: z.number().default(300),
    }).optional(),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

// En tu main.ts
const rawConfig = await loadAppConfig();
const config = AppConfigSchema.parse(rawConfig);
```

## .env.example Files

Each template and package includes a `.env.example` with the available variables. Copy this file as `.env` to get started:

```bash
cp .env.example .env
```

## Complete AppConfig

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Name of the application |
| `debug` | `boolean` | Debug mode |
| `logger.level` | `string` | Log level (`trace`, `debug`, `info`, `warn`, `error`, `fatal`) |
| `db.driver` | `string` | DB driver (`postgres`, `mysql`, `sqlite`, `libsql`) |
| `db.url` | `string` | Connection URL |
| `socket.enabled` | `boolean` | Enable WebSocket |
| `socket.port` | `number` | WebSocket port |
| `kv.driver` | `string` | KV driver (`memory`, `redis`) |
| `kv.connection` | `any` | KV connection config |
| `processes` | `Record<string, ProcessConfig>` | External processes |
