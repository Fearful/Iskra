---
title: Testing Kit
description: Shared test utilities for Iskra packages — mock App, Driver, Logger, temp dirs, and HTTP client.
---

Shared test utilities for Iskra packages — eliminates duplicated App/Driver/Logger bootstrapping across test suites.

## Quick Start

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

Returns a real `App` instance pre-configured for tests: logger at `error` level, OTel disabled, name defaults to `TestApp`. Accepts partial `AppConfig` overrides merged shallowly.

```typescript
const app = createTestApp({ name: 'MyTestSuite' });
app.register(myDriver);
await app.start();
await app.stop();
```

### `createMockLogger()`

Returns an object implementing the core `Logger` interface that captures all log calls into arrays for assertions. Produces no stdout/stderr output.

```typescript
const logger = createMockLogger();
logger.info('hello');
expect(logger.logs.info[0].args[0]).toBe('hello');
logger.reset(); // clears all captured entries
```

Available capture arrays: `logs.trace`, `logs.debug`, `logs.info`, `logs.warn`, `logs.error`, `logs.fatal`. Every level is enabled (`level` is `'trace'` and `isLevelEnabled()` returns `true`), so code that guards a log call with `isLevelEnabled()` is captured too.

### `createMockDriver(name?, hooks?)`

Returns a `Driver` that records every lifecycle call and its order. Optional hooks inject arbitrary behavior or throw errors.

```typescript
const driver = createMockDriver('my-driver', {
    stop: async () => { throw new Error('intentional'); },
});
// After lifecycle:
// driver.calls       => ['init', 'start', 'stop']
// driver.initialized => true
// driver.started     => true
// driver.stopped     => true
driver.reset();
```

### `withTempDir(fn)`

Creates a temp directory, invokes `fn(dir)`, and always removes it in a `finally` — even when `fn` throws.

```typescript
await withTempDir(async (dir) => {
    await Bun.write(`${dir}/data.json`, '{}');
    // dir is cleaned up on exit
});
```

### `createTestServer(handler)`

Wraps any object with a `.request()` method (structurally typed — no Hono import required) in a small fetch-style client for testing HTTP handlers.

```typescript
const client = createTestServer(honoApp);
const res = await client.get('/health');
expect(res.status).toBe(200);

const created = await client.post('/users', { name: 'Ana' });
expect(created.status).toBe(201);

await client.delete('/items/1');
```

## Testing a web service

`createTestKernel()` (in `@iskra-bun/web-kit/testing`) builds the app as WebPlugin does, features first and then the routes, with the same code, and without a port:

```typescript
import { createTestKernel } from '@iskra-bun/web-kit/testing';

const { request, close } = await createTestKernel({ router, features: [new RequestIdFeature(), new ErrorHandlerFeature()] });
const res = await request('/api/users/1', { headers: { Authorization: 'Bearer …' } });
expect(res.status).toBe(200);
await close();
```

It takes a `Router` or a Hono app as `router`, any `KernelConfig` (a `contract`, for instance), and uses `logger: false` unless you pass one.

## Testing a repository (Oracle)

`fakeOracle()` (in `@iskra-bun/db-oracle/testing`) is an `OracleDatabase`, answered by SQL matchers instead of a database: type a repository against `OracleDatabase` (or `OracleSession`) and pass it the driver in the app and the fake in tests.

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

- A matcher is a string contained in the SQL (ignoring case and whitespace), a RegExp or a function of the SQL and binds; the latest rule that matches answers, with rows, a result (`rows`, `rowsAffected`, `outBinds`), a function of the call, or an error. A statement no rule answers throws.
- The matchers see the SQL and binds as the repository wrote them. Row specs (`rows`) decode the rows as the driver does, `one()` throws `NoRowsError`, and `list()` counts and pages the rows its query's rule answers.
- `transaction(fn)` runs `fn` with the fake and counts `commits` and `rollbacks`.

## Parity with the service being replaced

`@iskra-bun/testing-kit/parity` sends the same requests to a service and to its replacement and names where the answers differ: the status, the headers you choose (`content-type` by default, missing ones included) and the body.

```typescript
import { compareCase } from '@iskra-bun/testing-kit/parity';

const options = {
    legacy: 'http://core-go.intranet:8080', // a base URL, or an app with request()
    candidate: (await createTestKernel({ router })).app,
    ignorePaths: ['$.timestamp', '$.data[*].updatedAt'],
    requestHeaders: { Authorization: `Bearer ${token}` },
};

for (const c of [{ path: '/api/usuarios/1' }, { path: '/api/usuarios?start=0&length=10' }]) {
    test(c.path, async () => expect((await compareCase(c, options)).differences).toEqual([]));
}
// ['$.data[0].nombre: "Ana" ≠ "ANA"', 'status: 404 ≠ 200', …]
```

- `mode: 'json'` (default) compares JSON bodies as values, key order aside; `mode: 'exact'` compares them as text, byte for byte, and `goHtmlEscape: true` reads Go's `\u003c`, `\u003e` and `\u0026` as the characters JS writes.
- Only GET and HEAD are sent unless `allowWrite: true`: other methods change data on both services.
- `compareAll(cases, options)` and `formatReport(results)` run and print a list; `casesFromHar(har)` reads the requests of a HAR capture.
- The `iskra-parity` command does it from the terminal and exits 1 when a case differs:

```bash
bunx iskra-parity --legacy http://old:8080 --candidate http://new:3000 cases.json
bunx iskra-parity --legacy … --candidate … --har capture.har --ignore '$.timestamp' --request-header 'Authorization: Bearer …'
```

## Environment Variables

None required.
