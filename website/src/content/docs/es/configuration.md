---
title: Configuración
description: Iskra usa c12 para cargar la configuracion y Zod para validarla.
---

Iskra usa c12 para cargar la configuracion y Zod para validarla.

## Archivo de Configuracion

Crea un archivo `app.config.ts` en la raiz de tu proyecto:

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

## Variables de Entorno

Iskra carga automaticamente archivos `.env` gracias a c12. No lee archivos `.apprc`, y carga capas `extends` solo desde rutas locales: las fuentes remotas (`github:`, `gitlab:`, `https://`) se descargarian y ejecutarian en cada arranque.

Crea un `.env` en tu proyecto:

```bash
# .env
NODE_ENV=development
PORT=3000
DATABASE_URL=postgres://user:pass@localhost:5432/miapp
REDIS_URL=redis://localhost:6379
```

Y usa las variables en tu config:

```typescript
export default {
    web: { port: Number(process.env.PORT) || 3000 },
    db: { driver: 'postgres', url: process.env.DATABASE_URL },
};
```

## Validacion con Zod

Podes definir un schema para validar la config en runtime:

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

## Archivos .env.example

Cada template y paquete incluye un `.env.example` con las variables disponibles. Copia este archivo como `.env` para empezar:

```bash
cp .env.example .env
```

## AppConfig Completa

| Campo | Tipo | Descripcion |
|-------|------|-------------|
| `name` | `string` | Nombre de la aplicacion |
| `debug` | `boolean` | Modo debug |
| `logger.level` | `string` | Nivel de log (`trace`, `debug`, `info`, `warn`, `error`, `fatal`) |
| `db.driver` | `string` | Driver de DB (`postgres`, `mysql`, `sqlite`, `libsql`) |
| `db.url` | `string` | URL de conexion |
| `socket.enabled` | `boolean` | Habilitar WebSocket |
| `socket.port` | `number` | Puerto del WebSocket |
| `kv.driver` | `string` | Driver de KV (`memory`, `redis`) |
| `kv.connection` | `any` | Config de conexion del KV |
| `processes` | `Record<string, ProcessConfig>` | Procesos externos |
