---
title: Architecture
description: Iskra's hexagonal architecture, layers, Drivers vs Plugins, lifecycle, and error hierarchy.
---

Iskra follows a **hexagonal architecture** (Ports & Adapters) that separates business logic from infrastructure details.

## Framework layers

```
┌─────────────────────────────────────────────────┐
│                  Tu Aplicacion                  │
│         (handlers, servicios, dominio)          │
├─────────────────────────────────────────────────┤
│               Capa de Plugins                   │
│      (extensiones opcionales del framework)     │
├─────────────────────────────────────────────────┤
│               Capa de Drivers                   │
│   WebPlugin │ DbDriver │ SocketDriver │ KV │ …  │
├─────────────────────────────────────────────────┤
│                 @iskra-bun/core                     │
│    App │ EventBus │ Logger │ Config │ DI │ Errors│
└─────────────────────────────────────────────────┘
```

## Core interfaces

### Driver

Each framework kit exposes a **Driver** that registers itself on the App:

```typescript
interface Driver {
    name: string;
    init(app: App): Promise<void> | void;
    start?(): Promise<void> | void;
    stop?(): Promise<void> | void;
}
```

The lifecycle is: `register() → init() → start() → stop()`.

### Plugin

Plugins are lightweight extensions without a full lifecycle:

```typescript
interface Plugin {
    name: string;
    install(app: App): Promise<void> | void;
}
```

### Feature (Web Kit)

Features are modules of the web Kernel with dependency resolution:

```typescript
interface Feature {
    name: string;
    dependencies?: string[];
    peerDependencies?: string[];
    initialize(kernel: Kernel): Promise<void>;
    routes?(app: Hono): void;
    shutdown?(): Promise<void>;
}
```

## Drivers vs Plugins

- A **Driver** has a full lifecycle (`init`/`start`/`stop`) and is registered with `app.register(driver)`. Use it when you manage a resource that opens and closes: an HTTP server, a database connection, a WebSocket server.
- A **Plugin** is lightweight and is installed immediately with `app.use(plugin)` via `install(app)`. Use it to extend behavior without managing a long-lived resource.

## Dependency injection

Iskra uses `app.context`, a `Map` whose keys are typed through `AppContextRegistry` (see [Core](/packages/core/)), as a DI container:

```typescript
// Un driver se registra en el contexto
app.context.set('db', dbDriver);

// Otro componente lo consume, tipado: DbDriver | undefined
const db = app.context.get('db');
```

## Event system

Components communicate through the event bus (based on mitt). Payloads are typed for the events declared in `AppEvents`:

```typescript
// Escuchar
app.on('order:created', async (ctx) => {
    const order = ctx.payload;
    ctx.logger.info({ order }, 'Orden creada');
});

// Emitir
app.emit('order:created', { id: 1, total: 150 });
```

## Error hierarchy

Every framework error extends `IskraError`:

```
IskraError
├── ConfigError
├── DriverError
├── PluginError
├── LifecycleError
├── HttpError (web-kit)
│   ├── ValidationError
│   ├── AuthError
│   ├── ForbiddenError
│   ├── NotFoundError
│   └── ConflictError
├── ConnectionError (db-kit)
├── QueryError (db-kit)
├── MigrationError (db-kit)
├── QueueError (worker-kit)
├── JobError (worker-kit)
├── SocketConnectionError (socket-kit)
└── SocketMessageError (socket-kit)
```

Each error has a `code`, a `context` (metadata) and supports `cause` (chaining).
