---
title: Migrar a las APIs tipadas
description: Cambios incompatibles que reemplazan `any` en las APIs publicas de core, web-kit y auth-kit, con pasos de migracion antes/despues.
---

Esta version saca `any` de las APIs publicas de `@iskra-bun/core`, `@iskra-bun/web-kit` y `@iskra-bun/auth-kit`. Los valores cuyo tipo el framework no puede conocer ahora son `unknown`, y cada lugar que guarda datos compartidos tiene un registro que extendes con declaration merging, asi tu codigo obtiene tipos reales en vez de casts. Los saltos de version son minor (los paquetes siguen en 0.x).

## core: `app.context` tipado

`app.context` era un `Map<string, any>`. Ahora es un `AppContext` (sigue siendo un `Map`): las claves que registran los kits estan tipadas y cualquier otra guarda `unknown`.

```typescript
// Antes: any
const db = app.context.get('db');

// Ahora: DbDriver | undefined (lo registra db-kit; 'kv' y 'oracle' igual)
const db = app.context.get('db');
```

Registra tus propias claves una vez y `get`/`set` quedan tipados en todos lados:

```typescript
declare module '@iskra-bun/core' {
    interface AppContextRegistry {
        bridge: DesktopBridge;
    }
}

app.context.set('bridge', new DesktopBridge(app));
const bridge = app.context.get('bridge'); // DesktopBridge | undefined
```

Sin registrar la clave, `get('clave')` devuelve `unknown`; `get<T>('clave')` le pone el tipo vos.

## core: eventos tipados

Los handlers de `app.on()` recibian `ctx.payload: any`. Los kits ahora declaran sus eventos (`process:*`, `socket:connected`/`disconnected`, `worker:dead-letter`) en `AppEvents`, asi que esos payloads estan tipados; el de cualquier otro evento es `unknown`.

```typescript
app.on('process:exit', (ctx) => {
    ctx.payload.exitCode; // number | null
});
```

Declara tus eventos de la misma forma y `app.emit()` tambien valida el payload:

```typescript
declare module '@iskra-bun/core' {
    interface AppEvents {
        'order:created': { id: string; total: number };
    }
}

app.on('order:created', (ctx) => ctx.payload.total); // number
app.emit('order:created', { id: 'o1', total: 150 });
```

`process:message` trae el JSON que imprimio un proceso hijo: su `message` es `unknown`, asi que revisa su forma antes de usarlo.

## core: las secciones extra de `AppConfig` son `unknown`

El index signature de `AppConfig` es `[key: string]: unknown` (era `any`). Lee una seccion propia con su tipo: `app.config.miSeccion as MiSeccion`. Las secciones de los kits (`db`, `kv`, `processes`, `socket`) siguen tipadas.

## web-kit: middlewares de validacion en lugar de las features de validacion

`ValidationFeature` y `JsonSchemaValidationFeature` le agregaban a Hono metodos sin tipos en tiempo de ejecucion (`app.postValidated()`, `app.postJsonValidated()`) y un `c.valid()` sin tipos. Se eliminaron. Usa los middlewares `validate()` (Zod) y `validateJson()` (JSON Schema), que no necesitan registrar una feature y le dan al handler los datos tipados en `c.get('validated')`:

```typescript
// Antes
kernel.registerFeature(new ValidationFeature());
// @ts-expect-error
app.postValidated('/users', { body: userSchema }, (c) => c.json(c.valid().body));

// Ahora
import { validate } from '@iskra-bun/web-kit';
app.post('/users', validate({ body: userSchema }), (c) => {
    const user = c.get('validated').body; // inferido de userSchema
    return c.json(user);
});

// JSON Schema: nombra la forma validada, un JSON Schema no tiene tipo de TypeScript
app.post('/users', validateJson<CreateUser>({ body: createUserSchema }), (c) => c.json(c.get('validated').body));
```

`validate()` acepta schemas de Zod v3 o v4. `createValidationMiddleware` y `createJsonSchemaValidationMiddleware` pasan a llamarse `validate` y `validateJson`.

## web-kit: las rutas de WebDriver infieren sus tipos con `defineRoute()`

`RouteOptions` y `WebContext` usan `unknown` por defecto en vez de `any`. Envolve una ruta con `schema` en `defineRoute()` para que su handler reciba los tipos del body y del query:

```typescript
import { createRouter, defineRoute } from '@iskra-bun/web-kit';

createRouter([
    defineRoute({
        method: 'POST',
        path: '/users',
        schema: { body: z.object({ name: z.string() }) },
        handler: (ctx) => userService.create(ctx.body.name), // ctx.body.name: string
    }),
]);
```

## web-kit: datos de sesion tipados

`c.get('session')` era un `Record<string, any>`; ahora es un `SessionData`, cuyos campos son `unknown` hasta que los declaras:

```typescript
declare module '@iskra-bun/web-kit' {
    interface SessionData {
        userId?: string;
    }
}

c.get('session').userId; // string | undefined
```

## web-kit: otros cambios de tipos

- Los callbacks de configuracion reciben el `Context` de Hono (era `any`): `authorize`, `keyGenerator`, `skip`, `handler`, `customExtractor`, `onError`, `onValidated`, los `checks` de health y `customHandlers`/`logger` del error handler.
- `CacheAdapter.get()` devuelve `Promise<unknown>`: acota lo que leas.
- `c.get('logger')` (LoggerFeature) es un `RequestLogger`.
- `OtelTracingConfig` son las opciones de `@hono/otel` con `serviceName` obligatorio, asi que tambien acepta sus otras opciones (`disableTracing`, `captureActiveRequests`).
- Se elimino `ApiKeyConfig.vaultService`: nunca se uso.
- `ApiKeyMetadata.metadata` y los `details` de los checks de health son `unknown`.

## auth-kit: los campos propios del usuario son `unknown`

`User` y `SignUpInput` aceptan campos propios con `[key: string]: unknown` (era `any`): acotalos donde los leas. `socialProviders` usa el tipo de la opcion de better-auth. El mapeo del perfil OIDC ya no devuelve un `id`: better-auth toma la identidad de la cuenta del `sub` verificado y lo ignoraba de todas formas.
