---
title: Web Kit
description: Hono-based HTTP server with a modular feature system.
---

The web-kit provides a Hono-based HTTP server with a modular feature system.

## Quick Start

```typescript
import { App } from '@iskra-bun/core';
import { WebPlugin, CorsFeature, HealthCheckFeature } from '@iskra-bun/web-kit';
import { Hono } from '@iskra-bun/web-kit/hono';

const app = new App({ name: 'MiAPI' });

// Your routes, as a Hono app mounted at "/".
const router = new Hono();
router.get('/api/users', (c) => c.json({ users: [] }));
router.post('/api/users', async (c) => {
    const body = await c.req.json();
    return c.json({ created: body }, 201);
});

const web = new WebPlugin({
    port: 3000,
    features: [
        new CorsFeature({ origin: '*' }),
        new HealthCheckFeature(),
    ],
    router,
});

app.register(web);
await app.start();
```

## Hono

web-kit is written in Hono types (`Kernel.getApp()`, `Feature.routes(app)`, the `c.get(...)` variables), so the app and web-kit must share one copy of `hono`. With two copies, a `HTTPException` thrown by the app is not an `instanceof` the one web-kit checks, and the context variables are typed against the other copy.

`hono` is a **peer dependency** of web-kit (`^4.12.34`): Bun, npm 7+ and pnpm install it, and an app that already lists `hono` must keep it in that range. To not depend on it directly, import it from web-kit:

```typescript
import { Hono, HTTPException, createMiddleware, isHTTPException, statusText } from '@iskra-bun/web-kit/hono';
import type { Context, MiddlewareHandler, ContentfulStatusCode } from '@iskra-bun/web-kit/hono';
```

`isHTTPException(err)` also recognizes a `HTTPException` from another copy of `hono` (an `Error` with an HTTP `status` and `getResponse()`); the Kernel's error handler uses it, so such an exception keeps its status instead of becoming a 500. `statusText(404)` gives `"Not Found"`.

## Routes in groups

`Router` organizes routes in groups with the middleware they share, and decides what a request no route takes gets:

```typescript
import { Router, WebPlugin } from '@iskra-bun/web-kit';

const api = new Router();
const v1 = api.group('/api/v1', requestLog); // middleware of every route in the group
v1.use(auth); // for the routes added after this line
const users = v1.group('/users', requireScopes('users:read')); // inherits requestLog and auth
users.get('/me', getMe);
users.get('/:id', getUser);
v1.unmatched({ then: 'auto' });

new WebPlugin({ router: api, features: [/* … */] });
```

- A route runs its groups' middleware (outer first), then its own: `users.get('/:id', audit, getUser)`.
- `use()` adds middleware to the routes and subgroups added **after** it, as in Echo.
- Routes are registered by priority, not in the order they were added: a static segment before a parameter before a wildcard (`/users/me` before `/users/:id`), and a route for a method before one for every method (`all()`). Two routes with the same method and path shape (`/users/:id`, `/users/:userId`) throw.
- `group.unmatched()` handles what no route under the group's prefix takes (an unknown path, a method without a route, a made-up method): it runs the group's middleware (or `use: [...]`), so a guest gets the 401 of the auth check instead of learning which paths exist, then answers **404** by the [response contract](#response-contract). With `then: 'auto'` a path that has routes for other methods answers **405** with `Allow: GET, HEAD, POST`. Paths outside any group with `unmatched()` get the Kernel's 404; the most specific prefix decides; calling it again for a prefix replaces the previous rule.
- `\:` in a path is a literal colon (`/items\:batch`).

`WebPlugin` compiles the router onto the Kernel's app after every feature's middleware, so security headers, CORS, CSRF or rate limit cover its routes. `router.compile(app)` does it on a Hono app of your own. A plain Hono app still works as `router`: it is mounted at `/`.

## WebDriver (standalone server)

`WebDriver` is a lightweight OpenAPIHono-based driver for exposing typed routes without the feature Kernel. It accepts `{ port, routes }` (it was previously named `WebServer` — **breaking change**, update your imports).

```typescript
import { WebDriver } from '@iskra-bun/web-kit';

const driver = new WebDriver({
    port: 3000,
    routes: [
        {
            method: 'GET',
            path: '/api/users',
            handler: async (ctx) => ({ users: [] }),
        },
    ],
});

app.register(driver);
await app.start();
```

A route with a `schema` validates the request with it; wrap it in `defineRoute()` so the handler's `ctx.body` and `ctx.query` get their types from the schema (inside a plain `routes` list they are `unknown`):

```typescript
import { defineRoute } from '@iskra-bun/web-kit';

defineRoute({
    method: 'POST',
    path: '/api/users',
    schema: { body: z.object({ name: z.string() }) },
    handler: async (ctx) => userService.create(ctx.body.name), // ctx.body.name: string
});
```

It applies the Kernel's default security headers (`X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`); a header a route sets itself, such as `X-Frame-Options: DENY`, is kept. A route's `schema.body` is validated whatever the request's `Content-Type`. Errors thrown by a handler are logged server-side; the client only receives `{ error: 'Internal Server Error' }` with a 500 status (the raw error message is never serialized, since it may embed connection strings or other secrets). Request bodies are capped at 16 MiB, as in the Kernel (`maxRequestBodySize`; Bun alone allows 128 MiB).

## Kernel

The `Kernel` is the micro-kernel that orchestrates the web features:

- Resolves dependencies between features (topological sort); a feature's `optionalDependencies` are initialized before it only if they are registered (that is how `CsrfFeature` runs after `SessionFeature`, whatever the order you register them in)
- Detects circular dependencies
- Initializes every feature (which registers its middleware) before registering any feature's routes, so each feature's middleware (CSRF, rate limit, auth, CORS…) applies to every route, whatever the order the features were registered in
- Refuses what would bypass that middleware: routes added to `getApp()` before `initialize()` (add them after `await kernel.initialize()`, or pass them as WebPlugin's `router`), routes a feature adds in `initialize()` instead of `routes()`, and a second feature with a name already registered (it used to replace the first one silently; `RateLimitFeature` takes a `name` for a second limiter)
- Applies security headers automatically (whatever you pass in `securityHeaders` is merged over the defaults); a header a route sets itself, such as a stricter `Content-Security-Policy`, is kept
- Manages the lifecycle (init, start, shutdown)

Server defaults, configurable in `new Kernel({ ... })`:

| Option | Default | What it does |
| :--- | :--- | :--- |
| `hostname` | `"0.0.0.0"` | Interface to bind (all; `"127.0.0.1"` for local only) |
| `maxRequestBodySize` | 16 MiB | Largest request body; Bun answers 413 above it |
| `idleTimeout` | 10 s (Bun) | Seconds a connection may stay idle |
| `shutdownGraceMs` | 5000 | How long `shutdown()` waits for in-flight requests before closing connections |
| `logger` | the console | Where the Kernel and its features log (see below); `false` for nothing |
| `trustProxy` | `false` | Number of reverse proxies in front of the app (`true` = 1); only then is `clientIpHeader` read (see [Rate limiting and client IP](#rate-limiting-and-client-ip)) |
| `clientIpHeader` | `"x-forwarded-for"` | The header those proxies put the client address in: `"x-forwarded-for"` or `"x-real-ip"` |

The Kernel and its features report startup, fallbacks and errors they handle through one logger: an object with `debug`, `info`, `warn` and `error(message, details?)`. `WebPlugin` passes the App's logger unless you set `logger`, so these messages share the app's format and level (each feature's startup line is `debug`). A feature you write gets it with `kernel.getLogger()` in `initialize()`. `fromStructuredLogger(pinoLogger)` adapts a pino-style logger.

`shutdown()` stops accepting connections, waits for in-flight requests (up to `shutdownGraceMs`) and shuts features down in reverse dependency order; if one fails it continues with the rest and throws an `AggregateError` at the end.

## Available Features

| Feature | Description |
|---------|-------------|
| `AuthFeature` | Authentication with Better Auth (OIDC, email/password) — powered by [`@iskra-bun/auth-kit`](/packages/auth-kit/) |
| `CorsFeature` | Origin control (CORS) |
| `CsrfFeature` | CSRF protection with tokens |
| `RateLimitFeature` | Request rate limiting (memory or Redis) |
| `ApiKeyFeature` | API key validation with scopes |
| `DbFeature` | Drizzle ORM integration |
| `CacheFeature` | Cache with Redis or memory |
| `SessionFeature` | Sessions (DB, cache, or memory) |
| `PermissionsFeature` | RBAC (roles and permissions) |
| `HealthCheckFeature` | Health checks (readiness/liveness) |
| `OpenAPIFeature` | Swagger/OpenAPI documentation |
| `LoggerFeature` | Request/response logging |
| `ErrorHandlerFeature` | Options for the Kernel's error handler: `includeStack`, a handler per status, a logger |
| `RequestIdFeature` | Request tracking with a unique ID |
| `OtelTracingFeature` | OpenTelemetry tracing (`@hono/otel`) |
| `UploadFeature` | File uploads |
| `StorageFeature` | File storage (local) — powered by [`@iskra-bun/storage-kit`](/packages/storage-kit/) |
| `EmailFeature` | Email sending (SMTP, SendGrid) — powered by [`@iskra-bun/mailer-kit`](/packages/mailer-kit/) |

## Request validation

Validation is a middleware, not a feature: `validate()` takes Zod schemas (v3 or v4), `validateJson()` JSON Schemas (AJV, with `ajv-formats` and `ajv-errors` messages). Either one answers 400 with the errors on invalid input; otherwise the handler reads the data from `c.get('validated')`, typed.

```typescript
import { validate, validateJson } from '@iskra-bun/web-kit';

app.post('/users', validate({ body: z.object({ name: z.string() }) }), (c) => {
    const { name } = c.get('validated').body; // string, inferred from the schema
    return c.json({ name }, 201);
});

// A JSON Schema has no TypeScript type: name the validated shape.
app.post('/orders', validateJson<CreateOrder>({ body: orderSchema }), (c) => c.json(c.get('validated').body));
```

Inside a handler, `bindBody()` and `bindQuery()` do the same and return the data, typed, or throw a `ValidationError` that the [response contract](#response-contract) answers:

```typescript
import { bindBody, bindQuery, queryParams } from '@iskra-bun/web-kit';

app.post('/personas', async (c) => {
    // `{ "NOMBRE": "Ana" }` fills `nombre`, as Go's encoding/json does.
    const persona = await bindBody(c, personaSchema, { caseInsensitiveKeys: true, allowForm: true });
    return ok(c, await personas.create(persona), { status: 201 });
});

app.get('/personas', (c) => {
    // ?ids=1&ids=2: a field declared as an array takes every value, the others the first.
    const { ids, q } = bindQuery(c, z.object({ ids: z.array(z.coerce.number()).optional(), q: z.string().optional() }));
    return list(c, await personas.find({ ids, q }));
});

queryParams(c); // ?id=1&id=2&q=ana → { id: ['1', '2'], q: 'ana' }
```

- A body is JSON (`application/json` or `+json`), or a form (urlencoded, multipart) with `allowForm` (repeated fields become arrays). Malformed JSON answers **400** (`BAD_REQUEST`), another content type **415** (`UNSUPPORTED_MEDIA_TYPE`), and an empty body is `{}`. `validate()` and `validateJson()` read it the same way (forms allowed); malformed JSON used to be validated as `{}`.
- `caseInsensitiveKeys` renames the keys that match the schema's ignoring case, in nested objects and arrays too (it reads a Zod object's shape). In the query a parameter named exactly as the field wins over one that only matches ignoring case. `validate()` takes it as an option too.
- A failed validation answers 400 `VALIDATION_ERROR` with the failed fields in `details`: Zod's `flatten()` by default, or `details: 'issues'` (`[{ path, message, code }]`), `'fields'` (`{ "address.city": ["Required"] }`) or a function of the issues, per call or for the whole app in the contract's `validationDetails`.

## DbFeature Schema Generic

`DbFeature` accepts an optional schema generic for fully-typed `c.get("db")` queries. Omitting it reproduces the previous untyped behavior (backward compatible).

```typescript
import * as schema from './db/schema';

new DbFeature<typeof schema>({ adapter: 'postgres', connection: { connectionString: process.env.DATABASE_URL } })

// In a route handler:
const users = await c.get('db').query.users.findMany();
//                                  ^-- typed to your schema
```

## HealthCheckFeature Readiness Checks

`/health/ready` now runs real checks instead of always returning ready. Register checks via `addReadinessCheck` or the `readinessChecks` config option:

```typescript
const health = new HealthCheckFeature();

health.addReadinessCheck('db', async () => {
    // return true = ready, false or throw = not ready
    await db.execute(sql`SELECT 1`);
    return true;
});
```

When any registered check returns `false`, throws, or takes longer than `checkTimeoutMs` (default 2000), `/health/ready` responds with **503** (`{ status: "not ready" }`) and logs the names of the failed checks as a warning. With no checks registered it always returns `ready` (previous behavior).

### Endpoint details

`includeDetails` defaults to **`false`**, for the three endpoints:

- `/health` answers `{ status, timestamp }`: no feature list, per-check results or raw error strings (errors are logged server-side).
- `/health/ready` answers `{ status }`: the check names (`checks`, `failed`) are left out, since they can describe the infrastructure (`postgres-primary-10.0.3.12`). The status code is what an orchestrator acts on.
- `/health/live` answers `{ status, timestamp }`, without `uptime`.

> **Breaking (0.x):** `/health/ready` and `/health/live` used to return the check names and the uptime whatever `includeDetails` said.

The checks (a real ping to the `DbFeature` database, the cache, and your own `checks`) always run, each with a timeout (`checkTimeoutMs`, 2 s by default). If any fails, `/health` answers **503** with `{ status: "error" }` so a load balancer or orchestrator can act on it.

To include the features, check results, check names and uptime, set `includeDetails: true`. Because this reveals internal information, **gate the endpoints behind authentication**:

```typescript
const health = new HealthCheckFeature({ includeDetails: true });
// Expose only on a protected route — not on the public /health
```

### Paths and bodies

Each endpoint can move (`path`, `readinessPath`, `livenessPath`) or be left out with `false`; the rate limiter only skips the ones served. `body` replaces an endpoint's JSON with your own, built from a report of what it found:

```typescript
const health = new HealthCheckFeature({
    path: false,
    readinessPath: '/healthcheck/ready',
    livenessPath: '/healthcheck/live',
    readinessChecks: { oracle: () => oracle.ping() },
    body: {
        live: () => ({ message: 'ok' }),
        ready: (report) => ({ message: report.ok ? 'ok' : 'unavailable' }),
    },
});
```

The report (`HealthReport`) has `endpoint` (`health`, `ready` or `live`), `ok`, each check by name in `checks` (a custom check's result as it returned it), the names in `failed`, `timestamp` and `uptime`. The status code is still 200 or 503 from `ok`; return a `Response` to choose everything yourself. The report carries the check names whatever `includeDetails` says, so leave out what must not be public.

## OpenAPI documentation

`OpenAPIFeature` serves the spec at `/openapi.json`, and an API reference page ([Scalar](https://github.com/scalar/scalar)) at `/docs`. The spec has the routes added with `addRoute()` and the app's own Hono routes that a `describeRoute()` describes (see [below](#routes-without-addroute)):

```typescript
new OpenAPIFeature({
    title: 'Orders API',
    version: '1.0.0',
    servers: [{ url: 'https://api.example.com' }],
    // Both routes: false answers 403, a Response is sent as it is.
    authorize: (c) => c.get('user')?.role === 'admin',
    // routes: 'all', // every Hono route, described or not; false for addRoute()'s only
    // scalar: 'local', // Scalar from node_modules, nothing from a CDN
    // docs: false,   // serve neither (in production, say)
    // scalar: false, // serve /openapi.json without the page
});
```

- The page loads one pinned `@scalar/api-reference` release from jsDelivr, with its Subresource Integrity hash and `crossorigin="anonymous"`: the browser refuses the script if the CDN serves anything else (it loaded `@latest`, so whatever Scalar published last ran on the app's origin). Update it, or serve it from your own origin, with `scalar: { src, integrity }`, where `integrity` is the `sha384-…` hash of that exact file.
- Without a CDN (an intranet, a strict CSP): `scalar: 'local'` serves the bundle of the installed `@scalar/api-reference` (an optional peer dependency: `bun add @scalar/api-reference`) from the app itself, at `/docs/scalar.js`, and the page's CSP allows scripts from `'self'` only. `scalar: { file }` does the same with a `standalone.js` you keep on disk. The app reads the file once, on the first request, and computes its SRI hash; a missing package fails at startup. `/docs/scalar.js` is public code and does not go through `authorize`.
- The page sends its own `Content-Security-Policy`: scripts only from that script's origin, requests only to the app's origin and to the spec's `servers` ("Try it"), nothing else loaded. Scalar's web fonts and its AI agent, which sends the spec to Scalar's servers, are off. The title is HTML-escaped.
- `/openapi.json` and `/docs` are registered in `routes()`, so middleware added to the app after `initialize()` (a `basicAuth()`, say) does not run for them: use `authorize`, which runs for both. Return a Response to answer with it, such as a Basic auth prompt:

```typescript
authorize: (c) => isDocsUser(c) || c.text('Unauthorized', 401, { 'WWW-Authenticate': 'Basic realm="docs"' }),
```

### Routes without addRoute()

Routes written as plain Hono (on a `Router`, on the Kernel's app, on a Hono app mounted with WebPlugin's `router`) are in the spec too, read from what their handlers carry. `describeRoute()` describes them; at runtime it only calls `next()`:

```typescript
import { Router, anyOf, apiKey, bearer, describeRoute, requireActor, requireScopes, validate } from '@iskra-bun/web-kit';
import { z } from 'zod';

const User = z.object({ id: z.number(), name: z.string() });

const api = new Router();
// On a group: every route under it gets the tag and the gate's security.
const users = api.group('/api/users', describeRoute({ tags: ['Users'] }), requireActor(anyOf(bearer(verify), apiKey(keys))));

users.get('/:id', describeRoute({ summary: 'A user', ok: User }), validate({ params: z.object({ id: z.coerce.number() }) }), getUser);
users.get('', describeRoute({ summary: 'Users', list: User }), listUsers);
users.post(
    '',
    describeRoute({ summary: 'Create a user', responses: { 201: { schema: User } } }),
    requireScopes('users:write'),
    validate({ body: z.object({ name: z.string().min(1) }) }),
    createUser,
);
```

What goes into each operation:

| From | In the spec |
| --- | --- |
| `describeRoute({ summary, description, tags, operationId, deprecated })` | As is. A route's tags are added to its groups'; the rest of the route's own overrides the group's. |
| `describeRoute({ ok: schema })` / `{ list: itemSchema }` | The 200 of `ok(c, data)` / `list(c, page)`, wrapped as the [response contract](#response-contract) answers (`{ success, data, message }`, `{ success, data, meta }`). |
| `describeRoute({ responses: { 201: { schema, description, contentType, headers } } })` | Those responses. Without any, a `200 OK`. |
| `describeRoute({ request: { params, query, headers, body, bodyTypes } })` | The request, for a route that reads it with `bindBody()`/`bindQuery()` instead of `validate()`. |
| `validate()`, `validateJson()` | Path, query and body parameters (JSON, and forms when `allowForm`), and a 400. |
| `requireActor(gate)` | The gate's security (`anyOf` gives alternatives, `allOf` schemes together) and a 401; the schemes go to `components.securitySchemes` (`bearer`, `jwt`, `apiKey`, `session`). |
| `identify(gate)` | The gate's security, and `{}`: credentials are optional. |
| `requireScopes(...scopes)` | The scopes in each security requirement, and a 403. |
| The contract | A `default` response and the 400/401/403 with the error body (`components.schemas.ErrorResponse`); `problemDetailsContract()` as `application/problem+json`. |

- Schemas can be Zod v3 or v4, any Standard Schema library that exports JSON Schema (Valibot, ArkType) or JSON Schema. A Zod v4 schema named with `.meta({ id: 'User' })` is listed once in `components.schemas` and referenced. What JSON Schema cannot represent (a date, a transform's output) is documented as any value.
- `describeRoute()` on an `app.use()` path applies to the routes registered after it under that path, as the middleware does at runtime. `describeRoute({ hidden: true })` leaves a route out, `security: []` marks one public under a global `security`.
- `routes: 'described'` (the default) lists the routes with a `describeRoute()`, on them or on their group; `routes: 'all'` every route with a path OpenAPI can state (no wildcards, a method other than `all()`). An `addRoute()` operation wins over a plain one for the same method and path. Hono's optional (`/:page?`) and regex (`/:id{[0-9]+}`) parameters become two paths and a `pattern`.
- A contract of your own documents its bodies in `schemas`: `{ error, errorType?, success?(data), list?(item) }`, as JSON Schema. Without `schemas`, the error responses have a description and no body.
- A gate of your own states its schemes in its `openapi` property: `Object.assign(gate, { openapi: [[{ name: 'mtls', scheme: { type: 'mutualTLS' } }]] })`. A gate without it still gets its 401.
- `documentRoutes(app.routes, { contract })` builds the same paths without the Feature, for a spec of your own.

## Access log

`LoggerFeature` gives each request a logger (`c.get('logger')`) and, with `accessLog: true`, writes one line per request when it ends. Through WebPlugin they go to the App's pino: the request's logger is its child, so every line carries the `requestId` (register `RequestIdFeature`), and the access line is `request completed` with `method`, `path`, `status`, `durationMs`, `requestId` and `actor` (`kind:id`, from a [gate](#gates-who-made-the-request)) as fields. On the Kernel's console logger they are text.

```typescript
new WebPlugin({ router, features: [new RequestIdFeature(), new LoggerFeature({ accessLog: true })] });
// {"level":30,"requestId":"…","method":"GET","path":"/api/users/7","status":200,"durationMs":12,"msg":"request completed"}
```

## Tracing

`OtelTracingFeature` creates a span per request with [`@hono/otel`](https://github.com/honojs/middleware/tree/main/packages/otel), through the app's OpenTelemetry setup (the global tracer provider, or the `tracer` or `tracerProvider` you pass):

```typescript
new OtelTracingFeature({
    serviceName: 'orders-api',
    ignoreIncomingTraceContext: true, // a service that faces the internet
});
```

- `url.full` is exported with the value of secret-looking query parameters replaced by `REDACTED` (`SECRET_QUERY_PARAMS` from `@iskra-bun/core`: `token`, `access_token`, `api_key`, `code`, `state`…), and so is the token of better-auth's `/reset-password/<token>` link: email verification and password reset links, and API keys in query strings, reached the collector. `redactedQueryParams` sets the list (`[]` keeps every value). Other tokens in paths are exported as they are.
- By default a request continues the trace named in its `traceparent` header. `ignoreIncomingTraceContext: true` starts a new trace for each request and drops the incoming `baggage`: on a public endpoint a client could otherwise force its requests to be sampled and attach them to a trace of its choosing. Keep the default behind a gateway that sets the trace context itself.
- The headers listed in `captureRequestHeaders` are exported as they are: do not list `authorization` or `cookie`.

## HTTP Errors

Throw an error from a route or a middleware and the Kernel answers it, with or without `ErrorHandlerFeature`:

```typescript
import { HttpError, NotFoundError, ValidationError } from '@iskra-bun/web-kit';

throw new NotFoundError('User not found');
// 404 { "error": "User not found", "status": 404, "code": "NOT_FOUND" }

throw new ValidationError('Invalid data', { field: 'email' });
// 400 { "error": "Invalid data", "status": 400, "code": "VALIDATION_ERROR", "details": { "field": "email" } }

throw new HttpError(423, 'The order is being edited', { headers: { 'Retry-After': '30' } });
// 423, code BAD_REQUEST (from the status) unless you pass `code`
```

By default every error answers `{ error, status, code, details?, context?, stack?, requestId? }`, the body the [SDKs](/guides/sdks/) read. How an error becomes that body:

| Thrown | Status and code | `error` (the message) |
|---|---|---|
| `HttpError` (and its subclasses) | its own | its message; `context` is sent for a 4xx |
| Hono's `HTTPException` (what CSRF, the rate limiter and auth throw) | its status; the code of that status (`429` → `RATE_LIMITED`) | its message |
| Any other `IskraError` | the status of its code (`NOT_FOUND` → 404, `CONFLICT` → 409, `TIMEOUT` → 504, 500 for the rest) | the status text (`Conflict`), or its message if the error has `expose = true` |
| Anything else | 500 `INTERNAL_ERROR` | `Internal Server Error` |

- A route that does not exist answers **404** `{ "error": "Not Found", "status": 404, "code": "NOT_FOUND" }` (it used to be Hono's plain-text `404 Not Found`).
- A HEAD request gets the status and headers, without a body.
- `requestId` is there when `RequestIdFeature` set one.
- A `HTTPException` that carries its own response (`basicAuth`'s 401) is sent as it is.
- `includeStack` (`KernelConfig.includeStack` or `ErrorHandlerFeature`, on by default only with `NODE_ENV=development`) adds `stack`, and the message and context of 5xx errors.
- Errors thrown are logged: a 4xx at `debug` (any client can cause as many as it likes), a 5xx at `error`.

`ErrorHandlerFeature` is optional: it sets `includeStack`, a handler per status (`customHandlers: { 404: (err, c) => … }`) and a `logger` for the errors.

### Error codes

The codes are `ErrorCodes` from `@iskra-bun/core`, and an app adds its own by declaration merging:

```typescript
declare module '@iskra-bun/core' {
    interface ErrorCodeRegistry {
        ORDER_LOCKED: true;
    }
}

throw new HttpError(423, 'The order is being edited', { code: 'ORDER_LOCKED' });
```

`statusForCode('NOT_FOUND')` and `codeForStatus(404)` give the mapping the Kernel uses.

## Response contract

The body of every response comes from one **response contract**, set once in `KernelConfig.contract` (or WebPlugin's): the Kernel's error handler and its 404 follow it, and so do `validate()` and `validateJson()`, OpenAPI's validation hook and routes, the refusals of `ApiKeyFeature`, `AuthFeature`, `PermissionsFeature`, `CsrfFeature`, `RateLimitFeature` and the upload routes, and the `ok()`, `list()` and `fail()` helpers. Iskra's (`iskraContract`) is the default; `problemDetailsContract()` answers [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) problem details (`application/problem+json`).

```typescript
import { WebPlugin, problemDetailsContract } from '@iskra-bun/web-kit';

new WebPlugin({ router, contract: problemDetailsContract() });
// 404 { "type": "about:blank", "title": "Not Found", "status": 404, "detail": "Not Found", "code": "NOT_FOUND", "instance": "/x" }
```

A contract of your own keeps the responses of a service you are migrating. Every error reaches it as a `Problem` (`{ status, code, message, details?, context?, stack?, requestId?, headers? }`):

```typescript
import type { ResponseContract } from '@iskra-bun/web-kit';

const contract: ResponseContract = {
    // Your own error classes; undefined leaves the rest to Iskra's mapping.
    toProblem: (error) =>
        error instanceof AppError ? { status: statusOf(error.kind), code: 'APP_ERROR', message: error.message } : undefined,
    // The error body (or a Response).
    error: (problem, c, error) =>
        error instanceof AppError
            ? { error: { code: problem.status, message: problem.message, metadata: error.fields ?? [] } }
            : { message: problem.message },
    // The body of ok(c, data) and of list(c, page).
    success: (data, c, { message }) => ({ ...(message && { message }), data }),
    list: (page, c) => ({
        draw: c.req.query('draw') ? Number(c.req.query('draw')) : null,
        recordsTotal: page.total,
        recordsFiltered: page.filtered,
        data: page.items,
    }),
    // Sees every problem, also the 400s of a validation.
    log: (problem, c) => { /* … */ },
};
```

In the routes:

```typescript
import { ok, list, fail } from '@iskra-bun/web-kit';

app.get('/users/:id', async (c) => ok(c, await users.find(c.req.param('id'))));
app.post('/users', async (c) => ok(c, await users.create(await c.req.json()), { status: 201, message: 'Created' }));
app.get('/users', async (c) => list(c, await oracle.paginate(query, pageParams(c.req.query()))));
app.delete('/users/:id', async (c) => {
    const error = await users.remove(c.req.param('id')); // an error as a value, not thrown
    return error ? fail(c, error) : c.body(null, 204);
});
```

`list()` takes db-oracle's `paginate()` and `paginateByCursor()` results as they are (`items` or `rows`, `total`, `filtered`, `page`, `pageSize`, `offset`, `limit`, `pages`, `nextCursor`). With Iskra's contract, `ok()` answers `{ success: true, data, message? }` and `list()` `{ success: true, data, meta: { total, … } }`. `fail(c, error)` answers what throwing `error` would, as a return value.

To turn the security headers off entirely (a proxy sets them), `securityHeaders: false`.

## Rate limiting and client IP

`RateLimitFeature` and the auth routes' limiter count requests per client IP. That is the socket address unless you tell the Kernel about the proxies in front of the app:

```typescript
new Kernel({
    trustProxy: 1,                     // one proxy: nginx, a load balancer
    clientIpHeader: 'x-forwarded-for', // the default; 'x-real-ip' if the proxy sets that one
});
```

- A request over the limit gets a 429 with `Retry-After`: the seconds until the client's window resets (at least 1). When the store does not know when it resets (`store: 'cache'` after the window's first hit), it is `windowMs`, an upper bound. A custom `handler` gets it too if it answers through `c` (`c.json()`, `c.text()`). The client SDKs read it into their rate-limit exception.
- Only `clientIpHeader` is read (**breaking**). `X-Real-IP` used to be the fallback when `X-Forwarded-For` was missing, and the client decides whether it is: behind a proxy that sets only `X-Real-IP` and passes `X-Forwarded-For` through, a made-up `X-Forwarded-For` was a new bucket on every request. If your proxy sets `X-Real-IP` (nginx: `proxy_set_header X-Real-IP $remote_addr`), set `clientIpHeader: 'x-real-ip'`; for `X-Forwarded-For`, each proxy must append to it (nginx: `$proxy_add_x_forwarded_for`).
- The health feature's routes (`/health`, `/health/ready`, `/health/live`, or the paths it is configured with) are not counted: orchestrator probes come every few seconds from one IP, and a kubelet went over the default 100 per 15 minutes, got 429 on `/health/live` and restarted the pod. Pass `skipHealthChecks: false` to count them.
- If requests carry `X-Forwarded-For` or `X-Real-IP` but `trustProxy` is not set, the limiter logs a warning once: behind a proxy every client would share the proxy's bucket.
- IPv6 clients are counted by their /64 prefix, since one host usually has a whole /64 to rotate through, and `::ffff:192.0.2.1` counts as `192.0.2.1`. `clientIpKey(ip)` returns that key for a limiter of your own.
- The memory store tracks at most `maxKeys` clients (default 100 000; past it the oldest are dropped) and sweeps expired ones every minute; the auth limiter takes `rateLimit: { maxKeys }` and `CacheFeature`'s memory adapter `maxEntries`, with the same default. Their timers do not keep the process alive. That adapter stores and returns copies (`structuredClone`), as values come back from Redis: changing a value read from the cache no longer changes the cached one.
- `CacheFeature` with Redis connects to managed services too: `connection: { url: process.env.REDIS_URL }` (`rediss://` for TLS; fields the URL leaves out come from the other options), an ACL `username`, and `tls: true` or Node TLS options. A command fails after `commandTimeoutMs` (default 2000) instead of waiting through every reconnect attempt, and connection errors go to the Kernel logger, one warning per outage, without the AUTH password.
- While the store is down, `RateLimitFeature` lets requests through without a limit and logs an error at most once a minute (`passOnStoreError`, default `true`): a Redis outage used to fail every request. With `passOnStoreError: false` it answers 503 with `Retry-After`. Cache-backed sessions still fail the request, since treating it as anonymous would log users out, but after `commandTimeoutMs` instead of hanging.
- `CacheFeature`'s Redis and memory adapters behave alike (**breaking**): Redis stores every value as JSON, strings too, so `'123'` reads back as a string, not `123` (raw strings older versions stored are still read), and a counter must therefore be stored as a number (`set('k', 5)`) or created by `increment()` (after `set('k', '5')`, `increment()` fails on Redis); a fractional TTL in seconds (`0.5`) works on Redis, which rejected it; and `increment()` on a missing or expired key creates it at 1 in memory, as Redis `INCR` does (it returned 0).

## Security Configuration

The Kernel sends these security headers by default:

- `X-Frame-Options: SAMEORIGIN`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`

`Content-Security-Policy`, `Strict-Transport-Security` (HSTS) and `Permissions-Policy` are opt-in, and `X-XSS-Protection` is off. Configure them with `securityHeaders`, merged over the defaults:

```typescript
new Kernel({
    securityHeaders: {
        xFrameOptions: 'DENY',
        strictTransportSecurity: { maxAge: 31536000, includeSubDomains: true },
        contentSecurityPolicy: { directives: { 'default-src': ["'self'"] } },
        permissionsPolicy: { camera: [], geolocation: [] },
    },
});
```

Only `false` turns a default header off (`xFrameOptions: false`). An option that is `undefined`, `null` or empty keeps the default: `xFrameOptions: process.env.X_FRAME_OPTIONS` with the variable unset used to remove the header. `securityHeaders: false` sets none of them (a proxy in front sets its own).

**Security hardening notes:**

- **CSRF (`CsrfFeature`):** HMAC-SHA256-signed double-submit cookie under the configured `secret`, compared in constant time, plus an `Origin` check; see the [CSRF](#csrf) section. The `disableCSRFCheck` kill-switch of `AuthFeature` is **ignored outside development** (only honored with `NODE_ENV` set to `development` or `test`), so better-auth's CSRF protection cannot be silently turned off in a deployed environment.
- **API keys (`ApiKeyFeature`):** keys are checked against the configured `staticKeys` on every request, so removing, expiring or narrowing a key takes effect at once; nothing is cached (`enableCache` and `cacheTtl` are ignored: a cached entry held the plaintext key and outlived its revocation). API key `id`s are random (UUID) and leak no prefix of the secret. Key comparison is constant-time. An `Authorization: Bearer` value that is not a valid API key is not rejected globally (it may be a JWT or session token from another scheme); routes that need an API key use `requireApiKey()` / `requireScope()`. An invalid key in the `X-API-Key` header still returns 401.
- **API key scopes:** a wildcard is a whole segment, `*` alone or a trailing `:*` (`users:*` grants `users:read` and `users:x:y`, not `usersX`); any other `*` is literal. **Breaking:** a trailing `*` used to be a raw prefix, so `user*` granted `users:read` and `user-admin:delete`.
- **CORS (`CorsFeature`):** `credentials: true` needs `origin` to name the allowed origins (a list or a function); with `origin` unset or `'*'`, `initialize()` throws (**breaking**). It used to send `Access-Control-Allow-Origin: *`, which browsers reject with credentials, and the usual way out was to reflect any origin.
- **Permissions (`PermissionsFeature`):** each user's permissions and roles are cached (with `CacheFeature`) for `cacheTTL` seconds, 60 by default (it was an hour): a role you revoke keeps working that long. Call `await kernel.getFeature('permissions')?.invalidate(userId)` after changing a user's roles or permissions to drop the cached copy; lower `cacheTTL`, or set `cachePermissions: false`, to trade database lookups for a shorter window. It runs after `auth`, `session` and `cache` whatever the order you register them in; none is required: without an auth or session feature every request is anonymous and gets only `anonymousPermissions`.
- **CSRF on specific routes:** `requireCsrf()` validates the token on that route even if its method is in `ignoreMethods` (e.g. a state-changing GET), and fails closed when `CsrfFeature` is not registered. For `multipart/form-data` forms, send the token in the `X-CSRF-Token` header.
- **Uploads (`UploadFeature`):** `exposeRoutes: true` requires `authorize(c, action, target?)` (`action`: `upload` | `list` | `download` | `delete`); use `authorize: () => true` only if the routes must be public. The body is cut off once it exceeds `maxFileSize` (413) without buffering it whole, the filename is sanitized, and internal errors are not returned to the client. `maxFileSize` plus 64 KiB of multipart overhead must fit in the Kernel's `maxRequestBodySize` (16 MiB by default): Bun rejects larger bodies before any route runs, so `initialize()` fails instead of the limit silently never being reached.
    - `target` is what the action touches: `{ key, subfolder, filename }`, plus `size` and `type` for `upload` (the folder's `{ key, subfolder }` for `list`); `subfolder` has no empty or `.`/`..` segments. `upload` is asked twice: first without a target, before the body is read, then with it, before anything is written. A check such as `Boolean(c.get('user'))` lets every signed-in user read and delete every file: scope the target to the user.
    - An upload never replaces a stored file: the route answers **409** unless `overwrite: true`.
    - The file is stored with a type from its extension (storage-kit's `contentTypeFor`), never the uploader's (Bun derives `File.type` from the name: `image/svg+xml`, `text/html`). Downloads are streamed, and only raster images are served inline: anything else comes with `Content-Disposition: attachment`, and every download with `Content-Security-Policy: sandbox`. On S3/MinIO the object stores the same disposition.
    - Without `allowedExtensions`, any extension is accepted except active web content (`.html`, `.htm`, `.shtml`, `.xhtml`, `.xht`, `.mht`, `.mhtml`, `.svg`, `.svgz`, `.xml`, `.xsl`, `.xslt`, `.js`, `.mjs`, `.cjs`), which a browser runs wherever it is served inline; list one in `allowedExtensions` to accept it (it is still stored as `application/octet-stream` and downloaded). With the `local` storage adapter, serve its folder with the headers described in [storage-kit](/packages/storage-kit/#content-type-and-disposition).
    - `c.get('upload').uploadFromRequest(request, field)` applies the same rules (**breaking**): it cuts the body off past `maxFileSize` and refuses an extension `allowedExtensions` does not allow, throwing an `HttpError` (413 `File too large`, 400 `Invalid extension`, 400 when the field holds no file). It used to read any body whole and store any extension. It follows the feature's `maxFileSize` and `allowedExtensions`, whether or not `exposeRoutes` is on.

    ```typescript
    new UploadFeature({
        projectName: 'app',
        exposeRoutes: true,
        // Each user reads and writes only under users/<id>/.
        authorize: (c, _action, target) => {
            const user = c.get('user');
            if (!user) return false;
            if (!target) return true; // upload, before the body is read
            const own = `users/${user.id}`;
            return target.subfolder === own || target.subfolder?.startsWith(`${own}/`) === true;
        },
    });
    ```
- **Email (`EmailFeature`):** the adapter it provides rejects a message (the returned promise rejects) whose `subject` or `headers` carry a CR/LF, or whose `to`/`cc`/`bcc`/`replyTo` entries are not each one bare address or `{ name, address }` object: see [mailer-kit's recipients](/packages/mailer-kit/#recipients). Object recipients are checked too (they passed as `"[object Object]"`).
- **Auth (`AuthFeature`):** the underlying `secret` must be **>= 32 characters** (validated by `@iskra-bun/auth-kit`); a shorter or empty secret is rejected at initialization, and so is a sample value in production. See the Auth section.

## Gates: who made the request

A **gate** proves who made a request and returns an **actor** (`{ kind, id, scopes? }`); gates combine, and `requireActor()` puts the actor in `c.var.actor`. They need neither `AuthFeature` nor a database of its own:

```typescript
import { anyOf, apiKey, hashedKeys, jwt, requireActor, requireScopes, session, staticKeys } from '@iskra-bun/web-kit';

const who = anyOf(
    jwt({ jwksUri: 'https://idp.example.com/.well-known/jwks.json', issuer: 'https://idp.example.com', audience: 'core' }),
    apiKey(hashedKeys((hash) => oracle.queryOne('SELECT id, scopes FROM api_keys WHERE key_hash = :hash', { hash }))),
    session(), // AuthFeature's user
);

app.get('/reports', requireActor(who), requireScopes('reports:read'), async (c) => {
    const actor = c.var.actor; // typed as the gates' actors
    return ok(c, await reports.for(actor.id));
});
```

| Gate | Proves |
|---|---|
| `bearer(verify)` | a bearer token your function checks (returns the actor, or null to refuse it) |
| `jwt({ secret \| jwksUri, issuer?, audience?, algorithms?, toActor? })` | a JWT, verified with Hono's JWT utilities: signature, `exp`/`nbf`, issuer, audience. Its actor is `{ kind: 'user', id: sub, scopes: scope \| scp, claims }` |
| `apiKey(store, { header?, bearer?, query?, toActor? })` | an API key in `X-API-Key` (or the bearer token, or a query parameter) found in a store: `staticKeys([...])` from the config, `hashedKeys(lookup)` from a table that holds `hashApiKey(key)` (SHA-256) instead of the key, or your own `{ find(key) }` |
| `session()` | the user `AuthFeature` put in `c.get('user')` |
| `anyOf(...gates)` | the first gate that proves one. A gate that finds its credential invalid does not stop the others (a bearer token may be a JWT or an API key); when none proves one, the first refusal answers |
| `allOf(...gates)` | every gate (a client certificate and a token); the first one's actor |

- `requireActor(gate)` answers **401** when the request carries no credential, with the gates' `WWW-Authenticate` challenge (`Bearer`), and when it carries an invalid one (`Bearer error="invalid_token"`, `Invalid API key`, `API key has expired`), by the [response contract](#response-contract).
- `identify(gate)` sets `c.var.actor` when the request proves one and lets a request without credentials through (a public route that shows more to a user); invalid credentials are still a 401.
- `requireScopes(...scopes)` answers 403 unless the actor has them all; `*` and a trailing `:*` (`users:*`) are wildcards.
- Under a [Router group](#routes-in-groups), `requireActor()` as the group's middleware also runs for the paths `unmatched()` answers, so a guest gets 401 rather than 404.
- A gate is a function `(c) => actor | null` that throws a 401 `AuthError` for a bad credential: write your own for anything else (a signed header, mTLS).

Declare the app's actor type once for `c.get('actor')` everywhere:

```typescript
declare module '@iskra-bun/web-kit' {
    interface ActorRegistry {
        actor: { kind: 'user' | 'apiKey'; id: string; scopes?: readonly string[]; legajo?: number };
    }
}
```

`ApiKeyFeature` takes a `store` too (`store: hashedKeys(...)`), looked up after its `staticKeys`.

## Auth

`AuthFeature` wraps Better Auth (powered by [`@iskra-bun/auth-kit`](/packages/auth-kit/)) and depends on `DbFeature`. It supports `email` (email/password) and `oidc` modes.

```typescript
import { AuthFeature } from '@iskra-bun/web-kit';

new AuthFeature({
    secret: process.env.AUTH_SECRET!, // required, >= 32 characters
    basePath: '/api/sso',             // default
    authMode: 'email',
});
```

- The `secret` signs sessions and **must be at least 32 characters**; a shorter or empty one throws at initialization. In production a sample value (one containing `change-me`, `dev-secret`…) throws too: see [auth-kit](/packages/auth-kit/).
- In `oidc` mode (or when `oidcConfig` is passed) email/password login is disabled; opt back in with `enableEmailPassword: true`. `enableSelfRegistration: false` rejects `/sign-up/email` (accounts are provisioned another way).
- `baseURL` is the app's public origin (it defaults to `BETTER_AUTH_URL`). Better Auth derives the cookies' `Secure` flag from it, so it is **required in production**: without it `http://localhost:3000` was used, and cookies went out without `Secure`. For the same reason it must be `https://` in production (**breaking**); only `localhost`, `127.0.0.1` and `[::1]` may use plain http (a proxy or docker compose on one machine). An `http://` origin used to be accepted, and the session cookies went out without `Secure`.
- Auth attempts (`POST` requests to `{basePath}/*` other than sign-out: sign-in, sign-up, password reset…) are rate-limited per IP by default (20 / 15 min, IPv6 clients by /64) to throttle credential stuffing; session reads and OAuth callbacks are not counted. In production Better Auth also applies its own, stricter per-path limits. Tune the first with `rateLimit: { max, windowMs, maxKeys }`, or pass `rateLimit: false` to turn both off when a backend calls these routes on behalf of many users from one IP (for example through the SDKs) and limits them itself.
- The client IP (for these limiters, the sessions' `ipAddress` and `RateLimitFeature`) is the socket address. If the app runs behind a proxy (nginx, a load balancer), set `new Kernel({ trustProxy: 1 })` to the number of proxies so the forwarded address is used (`X-Forwarded-For`, or `X-Real-IP` with `clientIpHeader: 'x-real-ip'`: see [Rate limiting and client IP](#rate-limiting-and-client-ip)); otherwise these headers are ignored, since any client can forge them.
- Sessions are checked against a signed cookie cache without a database lookup, so a session revoked by sign-out keeps working until that cache expires: `cookieCacheMaxAge` (seconds, default 300) sets how long.
- Use `requireAuth(kernel)` as middleware to protect routes that require a session. It reuses the session the feature already read for the request (`c.get("authUser")`) instead of reading it again.

## Sessions

```typescript
import { SessionFeature } from '@iskra-bun/web-kit';

new SessionFeature({
    store: 'cache',                        // 'memory' | 'cache' | 'db'
    secret: process.env.SESSION_SECRET!,   // required, >= 32 characters
});
```

- `c.get('session')` is a `SessionData` object: its fields are `unknown` until you declare them (`declare module '@iskra-bun/web-kit' { interface SessionData { userId?: string } }`), then typed on every request.
- To log out, empty the session (`delete c.get('session').userId`) or call `await c.get('destroySession')()`: either way the stored session and the cookie are removed.
- After login, call `await c.get('regenerateSession')()` to issue a new ID and invalidate the old one (prevents session fixation). With `CsrfFeature` it also issues a new CSRF token.
- A session destroyed by one request (logout, `regenerateSession`) is not re-created by another request that loaded it and finishes later. The save of a stored session writes it only if it still exists, checked and written in one step: in memory at once, on Redis with `SET ... XX`, in a database with an `UPDATE` of its row. It used to check (`get`) and then write (`set`), and on Redis or a database a logout landing between the two was undone. A custom `CacheAdapter` gets this with `setIfExists()`; without it the check is still a separate read. Each request works on its own copy of the session data, with the memory store too, so session data must be structured-cloneable (it already had to be JSON for the other stores).
- `c.get('sessionPersisted')` tells whether `sessionId` names a stored session: false for a new one, which is stored at the end of the request only if the handler puts data in it.
- With `store: 'db'`, a database error reading, writing or deleting a session fails the request (500, and no cookie is set). It used to be only logged: the client got a cookie for a session that was never stored, and a failed logout looked like a successful one. A row whose data is not valid JSON is logged and treated as no session.
- The cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` except in development: `new Kernel({ environment })` or, without it, `NODE_ENV` other than `development` / `test`, unset included; `cookieOptions.secure` overrides it.

## CSRF

```typescript
import { CsrfFeature } from '@iskra-bun/web-kit';

new CsrfFeature({
    secret: process.env.CSRF_SECRET!,              // required, >= 32 characters
    trustedOrigins: ['https://admin.example.com'], // other origins whose pages may post here
});
```

Requests with a method outside `ignoreMethods` (`GET`, `HEAD` and `OPTIONS` by default) must carry the token, `c.get('csrfToken')`, in the `X-CSRF-Token` header or a `_csrf` form field, matching the cookie, and come from the app's own pages:

- A request whose `Origin` is neither the app's own origin nor in `trustedOrigins` gets 403, and so does one without `Origin` whose `Sec-Fetch-Site` is `cross-site`. The browser's `Sec-Fetch-Site: same-origin` is taken as is, so a proxy that terminates TLS (the app sees `http://`) does not break same-origin forms; a browser that sends only `Origin` behind such a proxy needs the public origin in `trustedOrigins`. Requests with neither header (other servers, command-line clients) are left to the token. **Breaking:** a frontend on another origin, another subdomain included, must be listed in `trustedOrigins`.
- The cookie is `__Host-csrf` while it is `Secure` (the default): only the app's own host can set it. As `_csrf`, a sibling subdomain could set it for the parent domain with a token it knows and submit that token, and `SameSite` does not stop a same-site request. With `cookieOptions.secure: false` it is `_csrf`; a `cookieName` you set is kept.
- With `SessionFeature`, a request that has a stored session needs a token signed with that session's ID, so a token from another session or from an anonymous visit is rejected; anonymous requests get unbound tokens. From the app's own pages (`Sec-Fetch-Site: same-origin`, or its own or a trusted `Origin`) the unbound token is still accepted, and replaced by a bound one: the page that stored the session (a login without `regenerateSession()`, a cart) was rendered with it. `regenerateSession()` issues a new token, available as `c.get('csrfToken')` from then on (render it, or return it to a SPA). **Breaking:** a SPA must read the token again after signing in or out; a stale one is replaced on the next request, and an unsafe request carrying it gets 403. `CsrfFeature` runs after `SessionFeature` whatever the order you register them in.
- The `secret` must be at least 32 characters (**breaking**): a short one can be brute-forced offline from a single token, and then any token forged.

## Standardized Responses

`ok()` and `list()` (see [Response contract](#response-contract)) build success bodies by the app's contract. `successResponse(data, message)` gives Iskra's `{ success, data, message }` object for code that builds its own response; `errorResponse()` is kept for older code, but an error thrown (or `fail()`) answers by the contract and is logged.
