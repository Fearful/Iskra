---
title: Web Kit
description: Hono-based HTTP server with a modular feature system.
---

The web-kit provides a Hono-based HTTP server with a modular feature system.

## Quick Start

```typescript
import { App } from '@iskra-bun/core';
import { WebPlugin, CorsFeature, HealthCheckFeature } from '@iskra-bun/web-kit';
import { Hono } from 'hono';

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

It applies the Kernel's default security headers (`X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`). A route's `schema.body` is validated whatever the request's `Content-Type`. Errors thrown by a handler are logged server-side; the client only receives `{ error: 'Internal Server Error' }` with a 500 status (the raw error message is never serialized, since it may embed connection strings or other secrets). Request bodies are capped at 16 MiB, as in the Kernel (`maxRequestBodySize`; Bun alone allows 128 MiB).

## Kernel

The `Kernel` is the micro-kernel that orchestrates the web features:

- Resolves dependencies between features (topological sort)
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
| `ErrorHandlerFeature` | Centralized error handling |
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

When any registered check returns `false`, throws, or takes longer than `checkTimeoutMs` (default 2000), `/health/ready` responds with **503** and lists the failed check names. With no checks registered it always returns `ready` (previous behavior).

### /health endpoint details

`includeDetails` now defaults to **`false`** (change from previous versions). The unauthenticated `/health` endpoint no longer exposes the internal feature list or raw error strings: errors are logged server-side and the response is generic (`{ status: "ok", timestamp }`).

The checks (a real ping to the `DbFeature` database, the cache, and your own `checks`) always run, each with a timeout (`checkTimeoutMs`, 2 s by default). If any fails, `/health` answers **503** with `{ status: "error" }` so a load balancer or orchestrator can act on it.

To include feature and check details, set `includeDetails: true`. Because this reveals internal information, **gate the endpoint behind authentication**:

```typescript
const health = new HealthCheckFeature({ includeDetails: true });
// Expose only on a protected route — not on the public /health
```

## HTTP Errors

```typescript
import { HttpError, NotFoundError, ValidationError } from '@iskra-bun/web-kit';

// Tirar un error HTTP
throw new NotFoundError('Usuario no encontrado');

// Con contexto
throw new ValidationError('Datos invalidos', zodErrors, {
    context: { field: 'email' },
});

// Error HTTP generico
throw new HttpError(429, 'Demasiados requests', {
    code: 'BAD_REQUEST',
});
```

The `ErrorHandlerFeature` catches these errors automatically and returns them as JSON.

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

**Security hardening notes:**

- **CSRF (`CsrfFeature`):** HMAC-SHA256-signed double-submit cookie under the configured `secret`, compared in constant time. An unsigned or foreign token is rejected before any comparison. The `disableCSRFCheck` kill-switch is **ignored in production** (`NODE_ENV === 'production'`), so CSRF protection cannot be silently turned off in a deployed environment.
- **API keys (`ApiKeyFeature`):** keys are checked against the configured `staticKeys` on every request, so removing, expiring or narrowing a key takes effect at once; nothing is cached (`enableCache` and `cacheTtl` are ignored: a cached entry held the plaintext key and outlived its revocation). API key `id`s are random (UUID) and leak no prefix of the secret. Key comparison is constant-time. An `Authorization: Bearer` value that is not a valid API key is not rejected globally (it may be a JWT or session token from another scheme); routes that need an API key use `requireApiKey()` / `requireScope()`. An invalid key in the `X-API-Key` header still returns 401.
- **CSRF on specific routes:** `requireCsrf()` validates the token on that route even if its method is in `ignoreMethods` (e.g. a state-changing GET), and fails closed when `CsrfFeature` is not registered. For `multipart/form-data` forms, send the token in the `X-CSRF-Token` header.
- **Uploads (`UploadFeature`):** `exposeRoutes: true` requires `authorize(c, action)` (`action`: `upload` | `list` | `download` | `delete`); use `authorize: () => true` only if the routes must be public. The body is cut off once it exceeds `maxFileSize` (413) without buffering it whole, the filename is sanitized, and internal errors are not returned to the client. `maxFileSize` plus 64 KiB of multipart overhead must fit in the Kernel's `maxRequestBodySize` (16 MiB by default): Bun rejects larger bodies before any route runs, so `initialize()` fails instead of the limit silently never being reached.
- **Auth (`AuthFeature`):** the underlying `secret` must be **>= 32 characters** (validated by `@iskra-bun/auth-kit`); a shorter or empty secret is rejected at initialization. See the Auth section.

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

- The `secret` signs sessions and **must be at least 32 characters**; a shorter or empty one throws at initialization.
- In `oidc` mode (or when `oidcConfig` is passed) email/password login is disabled; opt back in with `enableEmailPassword: true`. `enableSelfRegistration: false` rejects `/sign-up/email` (accounts are provisioned another way).
- `baseURL` is the app's public origin (it defaults to `BETTER_AUTH_URL`). Better Auth derives the cookies' `Secure` flag from it, so it is **required in production**: without it `http://localhost:3000` was used, and cookies went out without `Secure`.
- Auth attempts (`POST` requests to `{basePath}/*` other than sign-out: sign-in, sign-up, password reset…) are rate-limited per IP by default (20 / 15 min) to throttle credential stuffing; session reads and OAuth callbacks are not counted. In production Better Auth also applies its own, stricter per-path limits. Tune the first with `rateLimit: { max, windowMs }`, or pass `rateLimit: false` to turn both off when a backend calls these routes on behalf of many users from one IP (for example through the SDKs) and limits them itself.
- The client IP (for these limiters, the sessions' `ipAddress` and `RateLimitFeature`) is the socket address. If the app runs behind a proxy (nginx, a load balancer), set `new Kernel({ trustProxy: 1 })` to the number of proxies so `X-Forwarded-For` is used; otherwise the header is ignored, since any client can forge it.
- Sessions are checked against a signed cookie cache without a database lookup, so a session revoked by sign-out keeps working until that cache expires: `cookieCacheMaxAge` (seconds, default 300) sets how long.
- Use `requireAuth(kernel)` as middleware to protect routes that require a session.

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
- After login, call `await c.get('regenerateSession')()` to issue a new ID and invalidate the old one (prevents session fixation).
- A session destroyed by one request (logout, `regenerateSession`) is not re-created by another request that loaded it and finishes later. Each request works on its own copy of the session data, with the memory store too, so session data must be structured-cloneable (it already had to be JSON for the other stores).
- The cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` in production (`new Kernel({ environment: 'production' })` or `NODE_ENV=production`); `cookieOptions.secure` overrides it.

## Standardized Responses

```typescript
import { successResponse, errorResponse } from '@iskra-bun/web-kit';

// Exito
return c.json(successResponse({ id: 1, name: 'Juan' }, 'Creado'));
// { success: true, data: { id: 1, name: 'Juan' }, message: 'Creado' }

// Error
return c.json(errorResponse('No encontrado', 'NOT_FOUND'), 404);
// { success: false, error: 'No encontrado', code: 'NOT_FOUND', timestamp: '...' }
```
