---
title: Authoring Plugins & Drivers
description: How to build a reusable Driver, Plugin, or Web Kit Feature for Iskra.
---

Iskra is extended through three contracts: **Drivers** (lifecycle-managed resources), **Plugins** (lightweight install-time extensions), and **Features** (Web Kit modules with dependency resolution). This guide shows how to author each one.

## Writing a Driver

Implement the `Driver` interface. The App calls `init()` then `start()` during `app.start()`, and `stop()` during `app.stop()`.

```typescript
import type { Driver, App } from '@iskra-bun/core';

export class MetricsDriver implements Driver {
  name = 'MetricsDriver';
  #app!: App;
  #timer?: ReturnType<typeof setInterval>;

  async init(app: App) {
    // Keep a reference; register services in the DI container.
    this.#app = app;
    app.context.set('metrics', this);
  }

  async start() {
    this.#timer = setInterval(() => {
      this.#app.emit('metrics:tick', { at: Date.now() });
    }, 5000);
    this.#app.logger.info('MetricsDriver started');
  }

  async stop() {
    if (this.#timer) clearInterval(this.#timer);
    this.#app.logger.info('MetricsDriver stopped');
  }
}
```

Register it:

```typescript
app.register(new MetricsDriver());
```

Declare what the driver puts on the app, so `app.context.get('metrics')` and `app.on('metrics:tick', …)` are typed for everyone using it (the kits do the same):

```typescript
declare module '@iskra-bun/core' {
  interface AppContextRegistry {
    metrics: MetricsDriver;
  }
  interface AppEvents {
    'metrics:tick': { at: number };
  }
}
```

### Guidelines

- **`init` acquires nothing heavy** — store the `App` reference and register DI entries. Do not open sockets or connections here.
- **`start` opens resources** — connections, servers, intervals.
- **`stop` is the mirror of `start`** — release everything, idempotently.
- **Throw typed errors** — wrap failures in `DriverError` with `cause` and `context` so the lifecycle reports them clearly.

## Writing a Plugin

Plugins have no lifecycle; `install(app)` runs immediately when you call `app.use(plugin)`.

```typescript
import type { Plugin, App } from '@iskra-bun/core';

export const requestIdPlugin: Plugin = {
  name: 'requestId',
  install(app: App) {
    app.context.set('genId', () => crypto.randomUUID());
    app.logger.debug('requestId plugin installed');
  },
};
```

```typescript
app.use(requestIdPlugin);
```

Use a Plugin when there is no resource to open or close — just behavior or helpers to attach.

## Writing a Web Kit Feature

Features are modules of the web `Kernel`. They declare dependencies and the Kernel resolves them with a topological sort.

```typescript
import type { Feature, Kernel } from '@iskra-bun/web-kit';
import type { Hono } from 'hono';

export class GreetingFeature implements Feature {
  name = 'greeting';
  dependencies = ['error-handler'];

  async initialize(kernel: Kernel) {
    // Set up shared state, read config from the kernel.
  }

  routes(app: Hono) {
    app.get('/greet/:name', (c) => c.json({ hello: c.req.param('name') }));
  }

  async shutdown() {
    // Optional cleanup.
  }
}
```

Add it to a `WebPlugin`:

```typescript
import { WebPlugin } from '@iskra-bun/web-kit';

app.register(new WebPlugin({ port: 3000, features: [new GreetingFeature()] }));
```

### `dependencies` vs `peerDependencies`

- `dependencies` — names of features that **must** be registered. They are initialized first, so their middleware runs before yours. A missing one is an error.
- `peerDependencies` — names of **npm packages** the feature needs. A missing one only logs a warning, and they do not change the initialization order.

Features with no dependency between them run their middleware in the order they were registered.

### Rules the Kernel enforces

- **Middleware in `initialize()`, routes in `routes()`.** Hono only runs the middleware registered before a route. The Kernel registers every feature's middleware first and every feature's routes after, so CSRF, rate limiting, auth and CORS apply to all routes. A feature that adds a route in `initialize()` would escape the middleware of the features initialized after it, so `initialize()` fails instead.
- **Unique names.** Registering a feature whose name is already taken throws. It used to replace the first one silently: a helper named `csrf` dropped the CSRF check. `RateLimitFeature` takes a `name` for a second limiter.
- **Routes after `initialize()`.** With a standalone `Kernel`, call `await kernel.initialize()` before `kernel.getApp().get(...)`: a route added earlier would skip the security headers and every feature's middleware, so `initialize()` throws. With `WebPlugin`, pass your routes as `router`.

A Driver, Plugin or Feature runs with full access to the app: its config and secrets, `app.context` (where `set()` replaces an existing key such as `db`) and every event on the bus. Review one as you would any other dependency.

## Packaging for reuse

Start from the [`plugin-starter`](https://github.com/fearful/iskra/tree/main/templates/plugin-starter) template. Export your Driver/Plugin from the package entry point and declare `@iskra-bun/core` as a peer dependency so consumers control the version. Use the caret range of the core version you build against (the template itself uses `workspace:*`, which only resolves inside this monorepo):

```json
{
  "peerDependencies": {
    "@iskra-bun/core": "^0.1.1"
  }
}
```

See [Architecture](/concepts/architecture/) for how these pieces fit into the layered model.
