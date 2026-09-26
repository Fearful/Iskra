# @iskra-bun/testing-kit

Utilidades compartidas de testing para paquetes de Iskra — elimina el bootstrapping duplicado de App/Driver/Logger en cada suite de tests.

## Inicio Rapido

```typescript
import {
    createTestApp,
    createMockLogger,
    createMockDriver,
    withTempDir,
    createTestServer,
} from '@iskra-bun/testing-kit';

// App real con logger silencioso
const app = createTestApp();

// Driver mock con registro de llamadas
const driver = createMockDriver();
app.register(driver);
await app.start();
// ['init', 'start']
console.log(driver.calls);

await app.stop();
```

## API

### `createTestApp(overrides?)`

Devuelve una instancia real de `App` configurada para tests: logger a nivel `error`, OTel desactivado, nombre `TestApp` por defecto. Se puede iniciar y parar normalmente.

```typescript
const app = createTestApp({ name: 'MiTest' });
app.register(myDriver);
await app.start();
await app.stop();
```

### `createMockLogger()`

Devuelve un objeto que implementa la interfaz `Logger` de core y captura todas las llamadas en arrays para aserciones.

```typescript
const logger = createMockLogger();
logger.info('mensaje');
expect(logger.logs.info[0].args[0]).toBe('mensaje');
logger.reset(); // borra todos los registros
```

Todos los niveles están habilitados (`level` es `'trace'` e `isLevelEnabled()` devuelve `true`), así que también se capturan las llamadas protegidas con `isLevelEnabled()`.

### `createMockDriver(name?, hooks?)`

Devuelve un `Driver` que registra las llamadas al ciclo de vida (`init`, `start`, `stop`) y su orden. Los hooks opcionales permiten inyectar comportamiento o lanzar errores.

```typescript
const driver = createMockDriver('mi-driver', {
    stop: async () => { throw new Error('fallo intencional'); },
});
// driver.calls => ['init', 'start', 'stop']
// driver.initialized / driver.started / driver.stopped => boolean
driver.reset();
```

### `withTempDir(fn)`

Crea un directorio temporal, ejecuta `fn(dir)` y lo elimina siempre al final, incluso si `fn` lanza.

```typescript
await withTempDir(async (dir) => {
    await Bun.write(`${dir}/data.json`, '{}');
    // dir se limpia al salir
});
```

### `createTestServer(handler)`

Envuelve cualquier objeto con `.request()` (compatible con Hono sin importarlo) en un cliente de test con métodos HTTP de conveniencia.

```typescript
const client = createTestServer(honoApp);
const res = await client.get('/health');
expect(res.status).toBe(200);

const created = await client.post('/users', { name: 'Ana' });
expect(created.status).toBe(201);
```
