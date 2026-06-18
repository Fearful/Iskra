---
title: Core
description: The App class, lifecycle, event system, logger, and error hierarchy of Iskra.
---

The core package is the foundation of the framework. It provides the `App` class, the event system, the logger, configuration loading, and the error hierarchy.

## App class

The `App` is the central orchestrator. It manages the lifecycle of all drivers and plugins.

```typescript
import { App } from '@iskra-bun/core';

const app = new App({
    name: 'MiApp',
    debug: true,
    logger: { level: 'debug' },
});

// Registrar drivers
app.register(webDriver);
app.register(dbDriver);

// Instalar plugins
app.use(miPlugin);

// Escuchar eventos
app.on('user:created', async (ctx) => {
    ctx.logger.info({ user: ctx.payload }, 'Usuario creado');
});

// Arrancar todo
await app.start();
```

### Lifecycle

1. **`new App(config?)`** — Creates the instance. If you don't pass a config, it is loaded automatically with c12.
2. **`app.register(driver)`** — Registers a driver (does not initialize it yet).
3. **`app.use(plugin)`** — Installs a plugin immediately.
4. **`app.start()`** — Calls `init()` on every driver, then `start()`.
5. **`app.stop()`** — Calls `stop()` on every driver. If one fails, it throws a `LifecycleError`.

### Context (DI)

```typescript
// Guardar
app.context.set('miServicio', instancia);

// Obtener
const srv = app.context.get('miServicio');
```

## Logger

Based on Pino. It is created automatically when you instantiate the App.

```typescript
app.logger.info('Mensaje informativo');
app.logger.error({ err, userId: 123 }, 'Algo fallo');
app.logger.debug({ data }, 'Debug info');

// Child logger (con contexto)
const childLogger = app.logger.child({ module: 'pagos' });
childLogger.info('Procesando pago');
```

### Levels

`trace` < `debug` < `info` < `warn` < `error` < `fatal`

Configured with `logger.level` in the app config.

## Configuration

Configuration is loaded with c12, which supports `.env` files and `app.config.ts`:

```typescript
// app.config.ts
export default {
    name: 'MiApp',
    debug: false,
    logger: { level: 'info' },
    db: {
        driver: 'sqlite',
        url: process.env.DATABASE_URL || 'app.db',
    },
};
```

### AppConfig

```typescript
interface AppConfig {
    name: string;
    debug?: boolean;
    logger?: { level?: string };
    db?: { driver: 'postgres' | 'mysql' | 'sqlite' | 'libsql'; url: string };
    socket?: { enabled: boolean; port?: number; adapter?: 'bun' | 'socket.io' };
    kv?: { driver: 'memory' | 'redis' | 'libsql'; connection?: any };
    processes?: Record<string, ProcessConfig>;
    [key: string]: any; // extensible
}
```

## Errors

Every error extends `IskraError`:

```typescript
import { IskraError, ConfigError, DriverError, ErrorCodes } from '@iskra-bun/core';

// Crear un error con contexto
throw new ConfigError('Falta la URL de la base de datos', {
    context: { field: 'db.url' },
});

// Encadenar errores
try {
    await conectar();
} catch (err) {
    throw new DriverError('No se pudo conectar al driver', {
        cause: err,
        context: { driver: 'postgres' },
    });
}

// Verificar tipo
if (err instanceof IskraError) {
    console.log(err.code);    // 'CONFIG_INVALID'
    console.log(err.context); // { field: 'db.url' }
    console.log(err.toJSON());
}
```

### ErrorCodes

Available codes: `INTERNAL_ERROR`, `NOT_INITIALIZED`, `CONFIG_INVALID`, `CONFIG_MISSING`, `DRIVER_INIT_FAILED`, `DRIVER_START_FAILED`, `DRIVER_STOP_FAILED`, `LIFECYCLE_START_FAILED`, `LIFECYCLE_STOP_FAILED`, `VALIDATION_ERROR`, `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`, `DATABASE_ERROR`, `CONNECTION_ERROR`, `QUERY_ERROR`, `MIGRATION_ERROR`, `QUEUE_ERROR`, `JOB_ERROR`, and more.
