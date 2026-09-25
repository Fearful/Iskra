---
title: Crear Plugins y Drivers
description: Cómo construir un Driver, Plugin o Feature de Web Kit reutilizable para Iskra.
---

Iskra se extiende a través de tres contratos: **Drivers** (recursos con ciclo de vida), **Plugins** (extensiones livianas que corren al instalar) y **Features** (módulos del Web Kit con resolución de dependencias). Esta guía muestra cómo crear cada uno.

## Escribir un Driver

Implementá la interfaz `Driver`. La App llama `init()` y luego `start()` durante `app.start()`, y `stop()` durante `app.stop()`.

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

Registralo:

```typescript
app.register(new MetricsDriver());
```

Declara lo que el driver deja en la app, asi `app.context.get('metrics')` y `app.on('metrics:tick', …)` quedan tipados para todos los que lo usen (los kits hacen lo mismo):

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

### Recomendaciones

- **`init` no adquiere nada pesado** — guardá la referencia a la `App` y registrá entradas de DI. No abras sockets ni conexiones acá.
- **`start` abre recursos** — conexiones, servidores, intervalos.
- **`stop` es el espejo de `start`** — liberá todo, de forma idempotente.
- **Tirá errores tipados** — envolvé las fallas en `DriverError` con `cause` y `context` para que el ciclo de vida las reporte con claridad.

## Escribir un Plugin

Los plugins no tienen ciclo de vida; `install(app)` corre de inmediato cuando llamás `app.use(plugin)`.

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

Usá un Plugin cuando no haya un recurso que abrir o cerrar — solo comportamiento o helpers que adjuntar.

## Escribir una Feature de Web Kit

Las features son módulos del `Kernel` web. Declaran dependencias y el Kernel las resuelve con un sort topológico.

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

Agregala a un `WebPlugin`:

```typescript
import { WebPlugin } from '@iskra-bun/web-kit';

app.register(new WebPlugin({ port: 3000, features: [new GreetingFeature()] }));
```

### `dependencies` vs `peerDependencies`

- `dependencies` — features que **deben** estar presentes e inicializarse primero. Si falta alguna, es un error.
- `peerDependencies` — features que, **si están presentes**, deben inicializarse primero, pero son opcionales.

## Empaquetar para reutilizar

Empezá desde el template [`plugin-starter`](https://github.com/fearful/iskra/tree/main/templates/plugin-starter). Exportá tu Driver/Plugin desde el entry point del paquete y declará `@iskra-bun/core` como peer dependency para que quien lo consuma controle la versión.

```json
{
  "peerDependencies": {
    "@iskra-bun/core": "workspace:*"
  }
}
```

Mirá [Arquitectura](/es/concepts/architecture/) para ver cómo encajan estas piezas en el modelo por capas.
