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

Arrays de captura disponibles: `logs.trace`, `logs.debug`, `logs.info`, `logs.warn`, `logs.error`, `logs.fatal`. Todos los niveles están habilitados (`level` es `'trace'` e `isLevelEnabled()` devuelve `true`), así que también se capturan las llamadas protegidas con `isLevelEnabled()`.

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

## Probar un servicio web

`createTestKernel()` (en `@iskra-bun/web-kit/testing`) arma la app como lo hace WebPlugin, primero las features y después las rutas, con el mismo código, y sin puerto:

```typescript
import { createTestKernel } from '@iskra-bun/web-kit/testing';

const { request, close } = await createTestKernel({ router, features: [new RequestIdFeature(), new ErrorHandlerFeature()] });
const res = await request('/api/users/1', { headers: { Authorization: 'Bearer …' } });
expect(res.status).toBe(200);
await close();
```

Acepta un `Router` o una app de Hono como `router`, cualquier `KernelConfig` (un `contract`, por ejemplo), y usa `logger: false` salvo que pases uno.

## Probar un repositorio (Oracle)

`fakeOracle()` (en `@iskra-bun/db-oracle/testing`) es un `OracleDatabase` que responde con matchers de SQL en vez de una base: tipa un repositorio contra `OracleDatabase` (u `OracleSession`) y pásale el driver en la app y el fake en los tests.

```typescript
import { fakeOracle } from '@iskra-bun/db-oracle/testing';

const oracle = fakeOracle();
oracle.on(/FROM usuarios WHERE id = :id/).reply([{ ID: 1, NOMBRE: 'Ana', ACTIVO: 'S' }]);
oracle.on('INSERT INTO usuarios').reply({ rowsAffected: 1, outBinds: { id: [42] } }).once();
oracle.on('FROM pedidos').fail(new QueryError('…'));

expect(await new UsuariosRepo(oracle).buscar(1)).toEqual({ id: 1, nombre: 'Ana', activo: true });
expect(oracle.calls[0]!.binds).toEqual({ id: 1 });
oracle.expectAllMatched();
```

- Un matcher es un string contenido en el SQL (sin distinguir mayúsculas ni espacios), una RegExp o una función del SQL y los binds; responde la última regla que coincide, con filas, un resultado (`rows`, `rowsAffected`, `outBinds`), una función de la llamada, o un error. Una sentencia que ninguna regla responde lanza un error.
- Los matchers ven el SQL y los binds como los escribió el repositorio. Las especificaciones de fila (`rows`) decodifican las filas como el driver, `one()` lanza `NoRowsError`, y `list()` cuenta y pagina las filas que responde la regla de su consulta.
- `transaction(fn)` corre `fn` con el fake y cuenta `commits` y `rollbacks`.

## Paridad con el servicio que se reemplaza

`@iskra-bun/testing-kit/parity` manda los mismos requests a un servicio y a su reemplazo y nombra dónde difieren las respuestas: el status, los headers que elijas (`content-type` por defecto, incluidos los que faltan) y el cuerpo.

```typescript
import { compareCase } from '@iskra-bun/testing-kit/parity';

const options = {
    legacy: 'http://core-go.intranet:8080', // una URL base, o una app con request()
    candidate: (await createTestKernel({ router })).app,
    ignorePaths: ['$.timestamp', '$.data[*].updatedAt'],
    requestHeaders: { Authorization: `Bearer ${token}` },
};

for (const c of [{ path: '/api/usuarios/1' }, { path: '/api/usuarios?start=0&length=10' }]) {
    test(c.path, async () => expect((await compareCase(c, options)).differences).toEqual([]));
}
// ['$.data[0].nombre: "Ana" ≠ "ANA"', 'status: 404 ≠ 200', …]
```

- `mode: 'json'` (por defecto) compara los cuerpos JSON como valores, sin importar el orden de las claves; `mode: 'exact'` los compara como texto, byte a byte, y `goHtmlEscape: true` lee los `\u003c`, `\u003e` y `\u0026` de Go como los caracteres que escribe JS.
- Sólo se mandan GET y HEAD salvo con `allowWrite: true`: los otros métodos cambian datos en los dos servicios.
- `compareAll(cases, options)` y `formatReport(results)` corren e imprimen una lista; `casesFromHar(har)` lee los requests de una captura HAR.
- El comando `iskra-parity` lo hace desde la terminal y sale con 1 cuando un caso difiere:

```bash
bunx iskra-parity --legacy http://old:8080 --candidate http://new:3000 cases.json
bunx iskra-parity --legacy … --candidate … --har capture.har --ignore '$.timestamp' --request-header 'Authorization: Bearer …'
```

## Variables de Entorno

Ninguna requerida.
