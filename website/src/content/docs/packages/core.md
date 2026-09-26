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
3. **`app.use(plugin)`** — Installs a plugin immediately (if `install` is async, `start()` waits for it and propagates its error).
4. **`app.start()`** — Calls `init()` on every driver, then `start()` one at a time in registration order. If a driver's `init()` fails, the drivers initialized so far (the failing one included) are stopped in reverse order; if a driver fails to start, every driver is stopped in reverse order. In both cases OpenTelemetry is shut down, the error is rethrown, and a later `app.stop()` stops nothing more.
5. **`app.stop()`** — Calls `stop()` in reverse start order (the web server before the database), continues past failures, and then throws a `LifecycleError` with all of them. OpenTelemetry is always shut down.

#### Shutdown on signals

After `start()`, `SIGTERM` and `SIGINT` run `app.stop()` and exit with code 0 (or 1 if it fails or exceeds `shutdownTimeoutMs`, 10 s by default). A second signal while it stops forces exit with code 1. Concurrent `app.stop()` calls (say, your own signal handler next to the App's) share one stop: each resolves once every driver has stopped. Configure with `shutdownSignals` (a list of signals, or `false` to disable); it is off under `NODE_ENV=test`.

### Context (DI)

`app.context` is a `Map` whose keys are typed through `AppContextRegistry`: the kits register theirs (`db`, `kv`, `oracle`), and you add yours with declaration merging. A key that is not registered holds `unknown`.

```typescript
declare module '@iskra-bun/core' {
    interface AppContextRegistry {
        myService: MyService;
    }
}

app.context.set('myService', instance);
const srv = app.context.get('myService'); // MyService | undefined
const db = app.context.get('db');          // DbDriver | undefined (db-kit)
```

### Events

`app.on(event, handler)` gives the handler `ctx.payload`; `app.emit(event, payload)` sends it. Events declared in `AppEvents` (the kits declare theirs: `process:*`, `socket:connected`, `worker:dead-letter`, …) have typed payloads, and `emit()` checks them; any other event's payload is `unknown`.

```typescript
declare module '@iskra-bun/core' {
    interface AppEvents {
        'user:created': { id: string; email: string };
    }
}

app.on('user:created', (ctx) => ctx.logger.info({ email: ctx.payload.email }, 'User created'));
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

### Secret redaction

The logger automatically censors sensitive fields in its output (in both development and production). A field with one of these names, at any depth of a plain object, array or logged error, is replaced with `[REDACTED]`; names are compared without case, `-` or `_` (`api_key` and `X-API-Key` are `apiKey`):

`password`, `pass`, `passwd`, `apiKey`, `apiSecret`, `token`, `authToken`, `accessToken`, `refreshToken`, `idToken`, `secret`, `clientSecret`, `secretKey`, `privateKey`, `authorization`, `proxyAuthorization`, `cookie`, `setCookie`, `sessionId`

So is a field whose name ends in `password`, `passwd`, `secret`, `token`, `apiKey`, `secretKey`, `privateKey` or `accessKey` (`dbPassword`, `x-auth-token`, `AWS_SECRET_ACCESS_KEY`). `config.env` and `*.data` are censored too, and so are the bindings of child loggers (`logger.child({ ... })`). The object you pass is not modified: the censored copy is what gets written.

Errors are written as pino writes them (type, message, stack, causes, their own fields), with their fields censored the same way: an HTTP client error's `config.headers.Authorization` does not reach the log. In messages, and in the message and stack of errors, the password of a `scheme://user:password@host` URL and secret-looking query parameters (`?authToken=`, `&X-Amz-Signature=`) are masked. Other values, and the fields of other class instances, are written as they are: scrub those before logging them.

```typescript
app.logger.info({ password: 'top-secret', userId: 123 }, 'Login');
// => { "password": "[REDACTED]", "userId": 123, "msg": "Login" }

app.logger.info({ config: { env: { DB_URL: '...' } } }, 'Config loaded');
// => config.env shows up as "[REDACTED]"
```

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
    kv?: { driver: 'memory' | 'redis'; connection?: string | Record<string, unknown> };
    processes?: Record<string, ProcessConfig>;
    [key: string]: unknown; // other sections: read them with their own type
}
```

### RestartBackoffConfig

Each `processes` entry accepts an optional `restartBackoff` that controls exponential backoff between restarts. All of its fields are optional and have defaults:

```typescript
interface RestartBackoffConfig {
    /** Initial delay in ms before the first restart. Default: 1000 */
    initialMs?: number;
    /** Maximum delay cap in ms. Default: 30000 */
    maxMs?: number;
    /** Multiplier applied to the delay after each restart. Default: 2 */
    factor?: number;
}
```

## OpenTelemetry

With an `otel` section, and the optional `@opentelemetry/*` packages installed, `app.start()` starts the OpenTelemetry Node SDK before the drivers, with OTLP/HTTP exporters and the Node auto-instrumentations (`fs` is off):

```typescript
import { SECRET_QUERY_PARAMS } from '@iskra-bun/core';

otel: {
    endpoint: 'https://otel-collector.example.com:4318', // default: http://localhost:4318
    serviceName: 'orders-api',
    instrumentations: {
        '@opentelemetry/instrumentation-http': {
            ignoreIncomingRequestHook: (req) => req.url === '/health',
            redactedQueryParams: [...SECRET_QUERY_PARAMS, 'sid'],
        },
        '@opentelemetry/instrumentation-dns': { enabled: false },
    },
},
```

Each entry of `instrumentations` is passed to that instrumentation as it is, so its own options (hooks, `redactedQueryParams`…) work, not only `enabled`.

HTTP spans export the URL of each request (`url.full`, or `http.url` and `http.target` in older releases), and a query string often carries a credential. Its secret-looking parameters are exported with the value `REDACTED`: those in `SECRET_QUERY_PARAMS` (`token`, `access_token`, `refresh_token`, `api_key`, `key`, `secret`, `password`, `code`, `state`, `ticket`, `signature`, `sig`, `X-Amz-Signature`…), compared without case, `-` or `_`. Set `redactedQueryParams` (outgoing requests) and `redactedQueryParamsServer` (incoming ones) on the HTTP instrumentation to choose the list, or `[]` to turn it off; a `requestHook` of your own still runs, after the redaction. Tokens in a path, and the headers you choose to capture, are exported as they are.

The startup log names the endpoint by its origin only: its path, query or userinfo can hold an API key. A plain `http://` endpoint on another host (not `localhost`, a private address, or a name without a dot or ending in `.local` or `.internal`) also logs a warning, since spans would travel unencrypted: use `https://`.

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
