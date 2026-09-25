---
title: Upgrading to the typed APIs
description: Breaking changes that replace `any` in the public APIs of core, web-kit and auth-kit, with before/after migration steps.
---

This release removes `any` from the public APIs of `@iskra-bun/core`, `@iskra-bun/web-kit` and `@iskra-bun/auth-kit`. Values whose type the framework cannot know are now `unknown`, and each place that holds shared data gets a registry you extend with declaration merging, so your code gets real types instead of casts. The version bumps are minor (the packages are still 0.x).

## core: `app.context` is typed

`app.context` was a `Map<string, any>`. It is now an `AppContext` (still a `Map`): the keys the kits register are typed, any other key holds `unknown`.

```typescript
// Before: any
const db = app.context.get('db');

// After: DbDriver | undefined (registered by db-kit; 'kv' and 'oracle' likewise)
const db = app.context.get('db');
```

Register your own keys once, and `get`/`set` are typed everywhere:

```typescript
declare module '@iskra-bun/core' {
    interface AppContextRegistry {
        bridge: DesktopBridge;
    }
}

app.context.set('bridge', new DesktopBridge(app));
const bridge = app.context.get('bridge'); // DesktopBridge | undefined
```

Without registering a key, `get('key')` returns `unknown`; `get<T>('key')` names the type yourself.

## core: typed events

`app.on()` handlers received `ctx.payload: any`. The kits now declare their events (`process:*`, `socket:connected`/`disconnected`, `worker:dead-letter`) in `AppEvents`, so those payloads are typed; any other event's payload is `unknown`.

```typescript
app.on('process:exit', (ctx) => {
    ctx.payload.exitCode; // number | null
});
```

Declare your own events the same way, and `app.emit()` checks the payload too:

```typescript
declare module '@iskra-bun/core' {
    interface AppEvents {
        'order:created': { id: string; total: number };
    }
}

app.on('order:created', (ctx) => ctx.payload.total); // number
app.emit('order:created', { id: 'o1', total: 150 });
```

`process:message` carries whatever JSON a child printed: its `message` is `unknown`, so check its shape before use.

## core: `AppConfig` extra sections are `unknown`

`AppConfig`'s index signature is `[key: string]: unknown` (it was `any`). Read a section of your own with its type: `app.config.mySection as MySection`. The kits' sections (`db`, `kv`, `processes`, `socket`) stay typed.

## web-kit: validation middlewares replace the validation features

`ValidationFeature` and `JsonSchemaValidationFeature` added untyped methods to Hono at run time (`app.postValidated()`, `app.postJsonValidated()`) and an untyped `c.valid()`. They are gone. Use the `validate()` (Zod) and `validateJson()` (JSON Schema) middlewares, which need no feature and give the handler typed data in `c.get('validated')`:

```typescript
// Before
kernel.registerFeature(new ValidationFeature());
// @ts-expect-error
app.postValidated('/users', { body: userSchema }, (c) => c.json(c.valid().body));

// After
import { validate } from '@iskra-bun/web-kit';
app.post('/users', validate({ body: userSchema }), (c) => {
    const user = c.get('validated').body; // inferred from userSchema
    return c.json(user);
});

// JSON Schema: name the validated shape, a JSON Schema has no TypeScript type
app.post('/users', validateJson<CreateUser>({ body: createUserSchema }), (c) => c.json(c.get('validated').body));
```

`validate()` takes Zod v3 or v4 schemas. `createValidationMiddleware` and `createJsonSchemaValidationMiddleware` are renamed to `validate` and `validateJson`.

## web-kit: WebDriver routes infer their types with `defineRoute()`

`RouteOptions` and `WebContext` default to `unknown` instead of `any`. Wrap a route with a `schema` in `defineRoute()` so its handler gets the body and query types from it:

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

## web-kit: typed session data

`c.get('session')` was a `Record<string, any>`; it is a `SessionData`, whose fields are `unknown` until you declare them:

```typescript
declare module '@iskra-bun/web-kit' {
    interface SessionData {
        userId?: string;
    }
}

c.get('session').userId; // string | undefined
```

## web-kit: other type changes

- Config callbacks receive Hono's `Context` (was `any`): `authorize`, `keyGenerator`, `skip`, `handler`, `customExtractor`, `onError`, `onValidated`, health `checks` and the error handler's `customHandlers`/`logger`.
- `CacheAdapter.get()` returns `Promise<unknown>`: narrow what you read.
- `c.get('logger')` (LoggerFeature) is a `RequestLogger`.
- `OtelTracingConfig` is `@hono/otel`'s options with `serviceName` required, so its other options (`disableTracing`, `captureActiveRequests`) are accepted too.
- `ApiKeyConfig.vaultService` is removed: it was never used.
- `ApiKeyMetadata.metadata` and health check `details` are `unknown`.

## auth-kit: custom user fields are `unknown`

`User` and `SignUpInput` allow custom fields with `[key: string]: unknown` (was `any`): narrow them where you read them. `socialProviders` takes better-auth's own option type. The OIDC profile mapping no longer returns an `id`: better-auth takes the account's identity from the verified `sub` and ignored it anyway.
