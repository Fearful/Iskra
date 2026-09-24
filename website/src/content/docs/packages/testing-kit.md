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

Available capture arrays: `logs.trace`, `logs.debug`, `logs.info`, `logs.warn`, `logs.error`, `logs.fatal`.

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

## Environment Variables

None required.
