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

## OpenAPI documentation

`OpenAPIFeature` serves the spec of the routes added with `addRoute()` at `/openapi.json`, and an API reference page ([Scalar](https://github.com/scalar/scalar)) at `/docs`:

```typescript
new OpenAPIFeature({
    title: 'Orders API',
    version: '1.0.0',
    servers: [{ url: 'https://api.example.com' }],
    // Both routes: false answers 403, a Response is sent as it is.
    authorize: (c) => c.get('user')?.role === 'admin',
    // docs: false,   // serve neither (in production, say)
    // scalar: false, // serve /openapi.json without the page
});
```

- The page loads one pinned `@scalar/api-reference` release from jsDelivr, with its Subresource Integrity hash and `crossorigin="anonymous"`: the browser refuses the script if the CDN serves anything else (it loaded `@latest`, so whatever Scalar published last ran on the app's origin). Update it, or serve it from your own origin, with `scalar: { src, integrity }`, where `integrity` is the `sha384-…` hash of that exact file.
- The page sends its own `Content-Security-Policy`: scripts only from that script's origin, requests only to the app's origin and to the spec's `servers` ("Try it"), nothing else loaded. Scalar's web fonts and its AI agent, which sends the spec to Scalar's servers, are off. The title is HTML-escaped.
- `/openapi.json` and `/docs` are registered in `routes()`, so middleware added to the app after `initialize()` (a `basicAuth()`, say) does not run for them: use `authorize`, which runs for both. Return a Response to answer with it, such as a Basic auth prompt:

```typescript
authorize: (c) => isDocsUser(c) || c.text('Unauthorized', 401, { 'WWW-Authenticate': 'Basic realm="docs"' }),
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

The `ErrorHandlerFeature` catches these errors automatically and returns them as JSON. It logs client errors (4xx) at `debug` level and server errors (5xx) at `error`: any client can cause as many 4xx as it likes, and they used to fill the error log. A 5xx `HttpError` keeps its message, but its `context` (which tends to describe the server: a DSN, a host) is only sent with `includeStack`.

## Rate limiting and client IP

`RateLimitFeature` and the auth routes' limiter count requests per client IP. That is the socket address unless you tell the Kernel about the proxies in front of the app:

```typescript
new Kernel({
    trustProxy: 1,                     // one proxy: nginx, a load balancer
    clientIpHeader: 'x-forwarded-for', // the default; 'x-real-ip' if the proxy sets that one
});
```

- Only `clientIpHeader` is read (**breaking**). `X-Real-IP` used to be the fallback when `X-Forwarded-For` was missing, and the client decides whether it is: behind a proxy that sets only `X-Real-IP` and passes `X-Forwarded-For` through, a made-up `X-Forwarded-For` was a new bucket on every request. If your proxy sets `X-Real-IP` (nginx: `proxy_set_header X-Real-IP $remote_addr`), set `clientIpHeader: 'x-real-ip'`; for `X-Forwarded-For`, each proxy must append to it (nginx: `$proxy_add_x_forwarded_for`).
- IPv6 clients are counted by their /64 prefix, since one host usually has a whole /64 to rotate through, and `::ffff:192.0.2.1` counts as `192.0.2.1`. `clientIpKey(ip)` returns that key for a limiter of your own.
- The memory store tracks at most `maxKeys` clients (default 100 000; past it the oldest are dropped) and sweeps expired ones every minute; the auth limiter takes `rateLimit: { maxKeys }` and `CacheFeature`'s memory adapter `maxEntries`, with the same default. Their timers do not keep the process alive. That adapter stores and returns copies (`structuredClone`), as values come back from Redis: changing a value read from the cache no longer changes the cached one.
- `CacheFeature`'s Redis and memory adapters behave alike (**breaking**): Redis stores every value as JSON, strings too, so `'123'` reads back as a string, not `123` (raw strings older versions stored are still read); a fractional TTL in seconds (`0.5`) works on Redis, which rejected it; and `increment()` on a missing or expired key creates it at 1 in memory, as Redis `INCR` does (it returned 0).

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

Only `false` turns a default header off (`xFrameOptions: false`). An option that is `undefined`, `null` or empty keeps the default: `xFrameOptions: process.env.X_FRAME_OPTIONS` with the variable unset used to remove the header.

**Security hardening notes:**

- **CSRF (`CsrfFeature`):** HMAC-SHA256-signed double-submit cookie under the configured `secret`, compared in constant time, plus an `Origin` check; see the [CSRF](#csrf) section. The `disableCSRFCheck` kill-switch of `AuthFeature` is **ignored in production** (`NODE_ENV === 'production'`), so better-auth's CSRF protection cannot be silently turned off in a deployed environment.
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
- The cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` in production (`new Kernel({ environment: 'production' })` or `NODE_ENV=production`); `cookieOptions.secure` overrides it.

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

```typescript
import { successResponse, errorResponse } from '@iskra-bun/web-kit';

// Exito
return c.json(successResponse({ id: 1, name: 'Juan' }, 'Creado'));
// { success: true, data: { id: 1, name: 'Juan' }, message: 'Creado' }

// Error
return c.json(errorResponse('No encontrado', 'NOT_FOUND'), 404);
// { success: false, error: 'No encontrado', code: 'NOT_FOUND', timestamp: '...' }
```
