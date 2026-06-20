# @iskra-bun/testing-kit

Utilidades compartidas de testing para paquetes de Iskra.

## Inicio Rapido

```typescript
import {
    createTestApp,
    createMockLogger,
    createMockDriver,
    withTempDir,
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

App real con logger silencioso para tests. Acepta anulaciones de config parciales.

```typescript
const app = createTestApp({ name: 'SuiteTest' });
```

### `createMockLogger()`

Logger que captura llamadas en arrays. No escribe en stdout.

```typescript
const logger = createMockLogger();
logger.info('ok');
expect(logger.logs.info[0].args[0]).toBe('ok');
logger.reset();
```

### `createMockDriver(name?, hooks?)`

Driver que registra el orden de llamadas al ciclo de vida.

```typescript
const driver = createMockDriver('db', {
    init: async (app) => { /* setup */ },
    stop: async () => { throw new Error('boom'); },
});
// driver.calls, driver.initialized, driver.started, driver.stopped
// driver.reset()
```

### `withTempDir(fn)`

Directorio temporal autolimpiable.

```typescript
await withTempDir(async (dir) => {
    // usa dir, se borra al salir
});
```

### `createTestServer(handler)`

Cliente HTTP de test para cualquier handler con `.request()` (Hono-compatible, sin importar Hono).

```typescript
const client = createTestServer(honoApp);
const res = await client.get('/health');
await client.post('/items', { name: 'test' });
await client.delete('/items/1');
```

## Variables de Entorno

Sin variables requeridas.
