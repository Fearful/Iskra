---
title: Core
description: La clase App, el ciclo de vida, el sistema de eventos, el logger y la jerarquía de errores de Iskra.
---

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
3. **`app.use(plugin)`** — Instala un plugin inmediatamente (si `install` es async, `start()` espera a que termine y propaga su error).
4. **`app.start()`** — Llama `init()` en todos los drivers y despues `start()` de a uno, en orden de registro. Si un driver falla al arrancar, detiene en orden inverso los que ya arrancaron y relanza el error.
5. **`app.stop()`** — Llama `stop()` en orden inverso al de arranque (el servidor web antes que la base de datos), sigue aunque alguno falle y al final tira `LifecycleError` con todos los errores. Siempre cierra OpenTelemetry.

#### Apagado por senales

Despues de `start()`, `SIGTERM` y `SIGINT` ejecutan `app.stop()` y terminan el proceso con codigo 0 (o 1 si falla o supera `shutdownTimeoutMs`, 10 s por defecto). Una segunda senal mientras se detiene fuerza la salida con codigo 1. Las llamadas simultaneas a `app.stop()` (por ejemplo un handler de senales propio junto al del App) comparten un mismo stop: cada una resuelve cuando todos los drivers se detuvieron. Configurable con `shutdownSignals` (lista de senales, o `false` para desactivarlo); bajo `NODE_ENV=test` viene desactivado.

### Contexto (DI)

`app.context` es un `Map` cuyas claves se tipan con `AppContextRegistry`: los kits registran las suyas (`db`, `kv`, `oracle`) y vos agregas las tuyas con declaration merging. Una clave no registrada guarda `unknown`.

```typescript
declare module '@iskra-bun/core' {
    interface AppContextRegistry {
        miServicio: MiServicio;
    }
}

app.context.set('miServicio', instancia);
const srv = app.context.get('miServicio'); // MiServicio | undefined
const db = app.context.get('db');          // DbDriver | undefined (db-kit)
```

### Eventos

`app.on(evento, handler)` le da al handler `ctx.payload`; `app.emit(evento, payload)` lo envia. Los eventos declarados en `AppEvents` (los kits declaran los suyos: `process:*`, `socket:connected`, `worker:dead-letter`, …) tienen payloads tipados, y `emit()` los valida; el payload de cualquier otro evento es `unknown`.

```typescript
declare module '@iskra-bun/core' {
    interface AppEvents {
        'user:created': { id: string; email: string };
    }
}

app.on('user:created', (ctx) => ctx.logger.info({ email: ctx.payload.email }, 'Usuario creado'));
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

### Redaccion de secretos

El logger censura automaticamente los campos sensibles en su salida (tanto en desarrollo como en produccion). Un campo con alguno de estos nombres, a cualquier profundidad de un objeto plano, array o error logueado, se reemplaza por `[REDACTED]`; los nombres se comparan sin mayusculas, `-` ni `_` (`api_key` y `X-API-Key` son `apiKey`):

`password`, `pass`, `passwd`, `apiKey`, `apiSecret`, `token`, `authToken`, `accessToken`, `refreshToken`, `idToken`, `secret`, `clientSecret`, `secretKey`, `privateKey`, `authorization`, `proxyAuthorization`, `cookie`, `setCookie`, `sessionId`

Tambien un campo cuyo nombre termina en `password`, `passwd`, `secret`, `token`, `apiKey`, `secretKey`, `privateKey` o `accessKey` (`dbPassword`, `x-auth-token`, `AWS_SECRET_ACCESS_KEY`). `config.env` y `*.data` tambien se censuran, igual que los bindings de los loggers hijos (`logger.child({ ... })`). El objeto que se pasa no se modifica: se escribe una copia censurada.

Los errores se escriben como los escribe pino (tipo, mensaje, stack, causas y sus propios campos), con sus campos censurados de la misma forma: el `config.headers.Authorization` de un error de un cliente HTTP no llega al log. En los mensajes, y en el mensaje y el stack de los errores, se enmascaran la contrasena de una URL `scheme://usuario:contrasena@host` y los parametros de query con pinta de secreto (`?authToken=`, `&X-Amz-Signature=`). Los demas valores, y los campos de otras instancias de clases, se escriben tal cual: hay que limpiarlos antes de loguearlos.

```typescript
app.logger.info({ password: 'top-secret', userId: 123 }, 'Login');
// => { "password": "[REDACTED]", "userId": 123, "msg": "Login" }

app.logger.info({ config: { env: { DB_URL: '...' } } }, 'Config cargada');
// => config.env aparece como "[REDACTED]"
```

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
    kv?: { driver: 'memory' | 'redis'; connection?: string | Record<string, unknown> };
    processes?: Record<string, ProcessConfig>;
    [key: string]: unknown; // otras secciones: leelas con su propio tipo
}
```

### RestartBackoffConfig

Cada entrada de `processes` acepta un `restartBackoff` opcional que controla el backoff exponencial entre reinicios. Todos sus campos son opcionales y tienen valores por defecto:

```typescript
interface RestartBackoffConfig {
    /** Demora inicial en ms antes del primer reinicio. Default: 1000 */
    initialMs?: number;
    /** Tope maximo de demora en ms. Default: 30000 */
    maxMs?: number;
    /** Multiplicador aplicado a la demora tras cada reinicio. Default: 2 */
    factor?: number;
}
```

## OpenTelemetry

Con una seccion `otel`, y los paquetes opcionales `@opentelemetry/*` instalados, `app.start()` arranca el SDK de OpenTelemetry para Node antes que los drivers, con exportadores OTLP/HTTP y las auto-instrumentaciones de Node (`fs` queda apagada):

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

Cada entrada de `instrumentations` se le pasa tal cual a esa instrumentacion, asi que sus propias opciones (hooks, `redactedQueryParams`…) funcionan, no solo `enabled`.

Los spans HTTP exportan la URL de cada request (`url.full`, o `http.url` y `http.target` en versiones anteriores), y un query string suele llevar una credencial. Sus parametros con pinta de secreto se exportan con el valor `REDACTED`: los de `SECRET_QUERY_PARAMS` (`token`, `access_token`, `refresh_token`, `api_key`, `key`, `secret`, `password`, `code`, `state`, `ticket`, `signature`, `sig`, `X-Amz-Signature`…), comparados sin mayusculas, `-` ni `_`. `redactedQueryParams` (requests salientes) y `redactedQueryParamsServer` (entrantes) en la instrumentacion HTTP eligen la lista, o `[]` la apaga; un `requestHook` propio se sigue ejecutando, despues de la redaccion. Los tokens en un path, y los headers que elijas capturar, se exportan tal cual.

El log de arranque nombra el endpoint solo por su origen: su path, query o userinfo pueden llevar una API key. Un endpoint `http://` sin cifrar en otro host (que no sea `localhost`, una direccion privada, o un nombre sin punto o terminado en `.local` o `.internal`) ademas registra un warning, porque los spans viajarian sin cifrar: usa `https://`.

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
