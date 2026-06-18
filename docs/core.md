# @iskra-bun/core

El paquete core es la base del framework. Provee la clase `App`, el sistema de eventos, el logger, la carga de configuracion y la jerarquia de errores.

## Clase App

La `App` es el orquestador central. Maneja el ciclo de vida de todos los drivers y plugins.

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

### Ciclo de Vida

1. **`new App(config?)`** — Crea la instancia. Si no le pasas config, la carga automaticamente con c12.
2. **`app.register(driver)`** — Registra un driver (no lo inicializa todavia).
3. **`app.use(plugin)`** — Instala un plugin inmediatamente.
4. **`app.start()`** — Llama `init()` en todos los drivers, despues `start()`.
5. **`app.stop()`** — Llama `stop()` en todos los drivers. Si alguno falla, tira `LifecycleError`.

### Contexto (DI)

```typescript
// Guardar
app.context.set('miServicio', instancia);

// Obtener
const srv = app.context.get('miServicio');
```

## Logger

Basado en Pino. Se crea automaticamente al instanciar la App.

```typescript
app.logger.info('Mensaje informativo');
app.logger.error({ err, userId: 123 }, 'Algo fallo');
app.logger.debug({ data }, 'Debug info');

// Child logger (con contexto)
const childLogger = app.logger.child({ module: 'pagos' });
childLogger.info('Procesando pago');
```

### Niveles

`trace` < `debug` < `info` < `warn` < `error` < `fatal`

Se configura con `logger.level` en la config de la app.

## Configuracion

La config se carga con c12, que soporta archivos `.env` y `app.config.ts`:

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

## Errores

Todos los errores extienden `IskraError`:

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

Codigos disponibles: `INTERNAL_ERROR`, `NOT_INITIALIZED`, `CONFIG_INVALID`, `CONFIG_MISSING`, `DRIVER_INIT_FAILED`, `DRIVER_START_FAILED`, `DRIVER_STOP_FAILED`, `LIFECYCLE_START_FAILED`, `LIFECYCLE_STOP_FAILED`, `VALIDATION_ERROR`, `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`, `DATABASE_ERROR`, `CONNECTION_ERROR`, `QUERY_ERROR`, `MIGRATION_ERROR`, `QUEUE_ERROR`, `JOB_ERROR`, y mas.
