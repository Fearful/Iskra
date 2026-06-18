---
title: Mobile Kit
description: Driver for running an Iskra App on mobile platforms (iOS / Android).
---

:::caution[Experimental]
`@iskra-bun/mobile-kit` is experimental. APIs may change between releases.
:::

Driver for running an Iskra App on mobile platforms (iOS / Android) over the [Tauri](https://tauri.app) bridge. It shares the same lifecycle model as the rest of the framework's Drivers.

## Installation

The package is already part of the monorepo. To use it in a template or app, declare it as a workspace dependency:

```json
{
    "dependencies": {
        "@iskra-bun/core": "workspace:*",
        "@iskra-bun/mobile-kit": "workspace:*",
        "@tauri-apps/api": "^2.0.0"
    }
}
```

```bash
bun install
```

## Quick Start

`MobileDriver` implements the Core's `Driver` interface. It registers with the App and takes part in the `init → start → stop` lifecycle:

```typescript
import { App } from '@iskra-bun/core';
import { MobileDriver } from '@iskra-bun/mobile-kit';

const app = new App({ name: 'MiAppMovil' });

app.register(new MobileDriver());

await app.start();
// → "Initializing Mobile Driver..."
// → "Mobile Driver started."
```

When you call `app.stop()` the driver releases its resources:

```typescript
await app.stop();
// → "Mobile Driver stopped."
```

## The MobileDriver class

The driver exposes three lifecycle methods. It requires no additional configuration to start:

```typescript
import type { Driver, App } from '@iskra-bun/core';

export class MobileDriver implements Driver {
    name = 'MobileDriver';

    async init(app: App) { /* guarda referencia a la App */ }
    async start() { /* registra listeners moviles: deep links, push, etc. */ }
    async stop() { /* limpieza */ }
}
```

| Method | When it runs | Purpose |
| --- | --- | --- |
| `init(app)` | In `app.init()` / `app.start()` | Receives the App and stores the reference |
| `start()` | In `app.start()`, after `init` | Point where native events are hooked up |
| `stop()` | In `app.stop()` | Closes listeners and releases resources |

## Platform Detection

A single codebase can register the `MobileDriver` only when it runs in a Tauri mobile environment. Detect the environment before registering:

```typescript
import { App } from '@iskra-bun/core';
import { MobileDriver } from '@iskra-bun/mobile-kit';

const app = new App({ name: 'MiApp' });

const isTauri = typeof window !== 'undefined' && '__TAURI__' in window;

if (isTauri) {
    app.register(new MobileDriver());
}

await app.start();
```

For a universal app (desktop + mobile) both drivers are registered and each acts according to its environment:

```typescript
import { App } from '@iskra-bun/core';
import { DesktopDriver } from '@iskra-bun/desktop-kit';
import { MobileDriver } from '@iskra-bun/mobile-kit';

const app = new App({ name: 'Universal' });

app.register(new DesktopDriver());
app.register(new MobileDriver());

await app.start();
```

## Mobile Events

The driver's `start()` is where native events (deep links, push notifications) are hooked up to the App's bus. Your business logic listens to them with `app.on(...)`:

```typescript
// Emitido desde el bridge nativo (Tauri) hacia el bus de la App
app.on('mobile:deeplink', async (ctx) => {
    app.logger.info({ url: ctx.payload.url }, 'Deep link recibido');
});

app.on('mobile:push', async (ctx) => {
    app.logger.info({ notification: ctx.payload }, 'Push recibido');
});
```

Each handler receives a `Context` with `app`, `logger`, `payload` and `reply`, just like the rest of the framework.

## Tauri Integration

`mobile-kit` depends on `@tauri-apps/api`. From the driver's `start()`, native commands defined in Tauri's Rust layer are invoked:

```typescript
import { invoke } from '@tauri-apps/api/core';

// Dentro de un metodo del driver o de un handler de evento
const battery = await invoke<number>('get_battery_level');
app.logger.info({ battery }, 'Nivel de bateria');
```

## Complete Example

```typescript
// src/main.ts
import { App } from '@iskra-bun/core';
import { MobileDriver } from '@iskra-bun/mobile-kit';

const app = new App({ name: 'NotasMovil' });

app.register(new MobileDriver());

app.on('mobile:deeplink', async (ctx) => {
    app.logger.info({ url: ctx.payload.url }, 'Abriendo desde deep link');
});

async function main() {
    await app.start();
    app.logger.info('App movil lista');
}

main().catch((err) => app.logger.error({ err }, 'Fallo al arrancar'));
```

For a ready-to-use cross-platform project, check the [`universal-app`](https://github.com/fearful/iskra/tree/main/templates/universal-app/README.md) template. For the Drivers' lifecycle, see the [architecture documentation](/iskra/concepts/architecture/) and the [Core](/iskra/packages/core/).
