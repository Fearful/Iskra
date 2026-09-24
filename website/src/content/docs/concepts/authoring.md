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
  dependencies = ['errorHandler'];

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

- `dependencies` — features that **must** be present and initialized first. Missing ones are an error.
- `peerDependencies` — features that, **if present**, should initialize first, but are optional.

## Packaging for reuse

Start from the [`plugin-starter`](https://github.com/fearful/iskra/tree/main/templates/plugin-starter) template. Export your Driver/Plugin from the package entry point and declare `@iskra-bun/core` as a peer dependency so consumers control the version.

```json
{
  "peerDependencies": {
    "@iskra-bun/core": "workspace:*"
  }
}
```

See [Architecture](/concepts/architecture/) for how these pieces fit into the layered model.
