---
title: Testing Kit
description: Utilidades de prueba compartidas para paquetes Iskra — App, Driver, Logger mock, directorios temporales y cliente HTTP.
---

Utilidades de prueba compartidas para paquetes Iskra — elimina el bootstrapping duplicado de App/Driver/Logger en los suites de pruebas.

## Inicio Rapido

```typescript
import {
    createTestApp,
    createMockLogger,
    createMockDriver,
    withTempDir,
    createTestServer,
} from '@iskra-bun/testing-kit';

const app = createTestApp();
const driver = createMockDriver();
app.register(driver);
await app.start();
// driver.calls => ['init', 'start']
await app.stop();
```

## API

### `createTestApp(overrides?)`

Devuelve una instancia real de `App` preconfigurada para pruebas: logger al nivel `error`, OTel deshabilitado, nombre por defecto `TestApp`. Acepta sobreescrituras parciales de `AppConfig` fusionadas de forma superficial.

```typescript
const app = createTestApp({ name: 'MyTestSuite' });
app.register(myDriver);
await app.start();
await app.stop();
```

### `createMockLogger()`

Devuelve un objeto que implementa la interfaz `Logger` del core y captura todas las llamadas de log en arrays para las aserciones. No produce salida en stdout/stderr.

```typescript
const logger = createMockLogger();
logger.info('hello');
expect(logger.logs.info[0].args[0]).toBe('hello');
logger.reset(); // limpia todas las entradas capturadas
```

Arrays de captura disponibles: `logs.trace`, `logs.debug`, `logs.info`, `logs.warn`, `logs.error`, `logs.fatal`.

### `createMockDriver(name?, hooks?)`

Devuelve un `Driver` que registra cada llamada del ciclo de vida y su orden. Los hooks opcionales inyectan comportamiento arbitrario o lanzan errores.

```typescript
const driver = createMockDriver('my-driver', {
    stop: async () => { throw new Error('intentional'); },
});
// Tras el ciclo de vida:
// driver.calls       => ['init', 'start', 'stop']
// driver.initialized => true
// driver.started     => true
// driver.stopped     => true
driver.reset();
```

### `withTempDir(fn)`

Crea un directorio temporal, invoca `fn(dir)` y siempre lo elimina en un bloque `finally` — incluso cuando `fn` lanza un error.

```typescript
await withTempDir(async (dir) => {
    await Bun.write(`${dir}/data.json`, '{}');
    // dir se elimina al salir
});
```

### `createTestServer(handler)`

Envuelve cualquier objeto con un método `.request()` (tipado estructuralmente — no requiere importar Hono) en un pequeño cliente estilo fetch para probar handlers HTTP.

```typescript
const client = createTestServer(honoApp);
const res = await client.get('/health');
expect(res.status).toBe(200);

const created = await client.post('/users', { name: 'Ana' });
expect(created.status).toBe(201);

await client.delete('/items/1');
```

## Variables de Entorno

Ninguna requerida.
