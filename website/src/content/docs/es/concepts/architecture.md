---
title: Arquitectura
description: Arquitectura hexagonal de Iskra, capas, Drivers vs Plugins, ciclo de vida y jerarquía de errores.
---

Iskra sigue una **arquitectura hexagonal** (Ports & Adapters) que separa la logica de negocio de los detalles de infraestructura.

## Capas del Framework

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

## Interfaces Fundamentales

### Driver

Cada kit del framework expone un **Driver** que se registra en la App:

```typescript
interface Driver {
    name: string;
    init(app: App): Promise<void> | void;
    start?(): Promise<void> | void;
    stop?(): Promise<void> | void;
}
```

El ciclo de vida es: `register() → init() → start() → stop()`.

### Plugin

Los plugins son extensiones livianas que no tienen ciclo de vida completo:

```typescript
interface Plugin {
    name: string;
    install(app: App): Promise<void> | void;
}
```

### Feature (Web Kit)

Las features son modulos del Kernel web con resolucion de dependencias:

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

- Un **Driver** tiene ciclo de vida completo (`init`/`start`/`stop`) y se registra con `app.register(driver)`. Úsalo cuando manejes un recurso que se abre y se cierra: un servidor HTTP, una conexión de base de datos, un servidor WebSocket.
- Un **Plugin** es liviano y se instala de inmediato con `app.use(plugin)` a través de `install(app)`. Úsalo para extender el comportamiento sin administrar un recurso de larga duración.

## Inyeccion de Dependencias

Iskra usa un `Map<string, any>` simple como contenedor de DI a traves de `app.context`:

```typescript
// Un driver se registra en el contexto
app.context.set('db', dbDriver);

// Otro componente lo consume
const db = app.context.get('db');
```

## Sistema de Eventos

La comunicacion entre componentes se hace via el event bus (basado en mitt):

```typescript
// Escuchar
app.on('order:created', async (ctx) => {
    const order = ctx.payload;
    ctx.logger.info({ order }, 'Orden creada');
});

// Emitir
app.emit('order:created', { id: 1, total: 150 });
```

## Jerarquia de Errores

Todos los errores del framework extienden de `IskraError`:

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

Cada error tiene `code`, `context` (metadata) y soporte para `cause` (encadenamiento).
