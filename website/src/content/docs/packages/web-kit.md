---
title: Web Kit
description: Hono-based HTTP server with a modular feature system.
---

The web-kit provides a Hono-based HTTP server with a modular feature system.

## Quick Start

```typescript
import { App } from '@iskra-bun/core';
import { WebPlugin, CorsFeature, HealthCheckFeature } from '@iskra-bun/web-kit';

const app = new App({ name: 'MiAPI' });

const web = new WebPlugin({
    port: 3000,
    features: [
        new CorsFeature({ origin: '*' }),
        new HealthCheckFeature(),
    ],
    router: (hono) => {
        hono.get('/api/users', (c) => c.json({ users: [] }));
        hono.post('/api/users', async (c) => {
            const body = await c.req.json();
            return c.json({ created: body }, 201);
        });
    },
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

It applies the same standard security headers as the Kernel HTTP stack. Errors thrown by a handler are logged server-side; the client only receives `{ error: 'Internal Server Error' }` with a 500 status (the raw error message is never serialized, since it may embed connection strings or other secrets).

## Kernel

The `Kernel` is the micro-kernel that orchestrates the web features:

- Resolves dependencies between features (topological sort)
- Detects circular dependencies
- Applies security headers automatically
- Manages the lifecycle (init, start, shutdown)

## Available Features

| Feature | Description |
|---------|-------------|
| `AuthFeature` | Authentication with Better Auth (OIDC, email/password) — powered by [`@iskra-bun/auth-kit`](/packages/auth-kit/) |
| `CorsFeature` | Origin control (CORS) |
| `CsrfFeature` | CSRF protection with tokens |
| `RateLimitFeature` | Request rate limiting (memory or Redis) |
| `ApiKeyFeature` | API key validation with cache and scopes |
| `ValidationFeature` | Request validation with Zod |
| `DbFeature` | Drizzle ORM integration |
| `CacheFeature` | Cache with Redis or memory |
| `SessionFeature` | Sessions (DB, cache, or memory) |
| `PermissionsFeature` | RBAC (roles and permissions) |
| `HealthCheckFeature` | Health checks (readiness/liveness) |
| `OpenAPIFeature` | Swagger/OpenAPI documentation |
| `LoggerFeature` | Request/response logging |
| `ErrorHandlerFeature` | Centralized error handling |
| `RequestIdFeature` | Request tracking with a unique ID |
| `TracingFeature` | Observability |
| `UploadFeature` | File uploads |
| `StorageFeature` | File storage (local) — powered by [`@iskra-bun/storage-kit`](/packages/storage-kit/) |
| `EmailFeature` | Email sending (SMTP, SendGrid) — powered by [`@iskra-bun/mailer-kit`](/packages/mailer-kit/) |

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

When any registered check returns `false` or throws, `/health/ready` responds with **503** and lists the failed check names. With no checks registered it always returns `ready` (previous behavior).

### /health endpoint details

`includeDetails` now defaults to **`false`** (change from previous versions). The unauthenticated `/health` endpoint no longer exposes the internal feature list or raw error strings: errors are logged server-side and the response is generic (`{ status: "ok", timestamp }`).

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

The Kernel applies security headers by default:

- `Content-Security-Policy`
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Strict-Transport-Security` (HSTS)
- `Permissions-Policy`

They can be customized via `KernelConfig.security`.

**Security hardening notes:**

- **CSRF (`CsrfFeature`):** HMAC-SHA256-signed double-submit cookie under the configured `secret`, compared in constant time. An unsigned or foreign token is rejected before any comparison. The `disableCSRFCheck` kill-switch is **ignored in production** (`NODE_ENV === 'production'`), so CSRF protection cannot be silently turned off in a deployed environment.
- **API keys (`ApiKeyFeature`):** the cache key is a **SHA-256** hash of the key (the raw key is never persisted in the cache, e.g. Redis). API key `id`s are random (UUID) and leak no prefix of the secret. Key comparison is constant-time.
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
- Auth routes (`{basePath}/*`) are rate-limited per IP by default (20 attempts / 15 min) to throttle credential stuffing.
- The client IP (for this limiter and for `RateLimitFeature`) is the socket address. If the app runs behind a proxy (nginx, a load balancer), set `new Kernel({ trustProxy: 1 })` to the number of proxies so `X-Forwarded-For` is used; otherwise the header is ignored, since any client can forge it.
- Use `requireAuth(kernel)` as middleware to protect routes that require a session.

## Sessions

```typescript
import { SessionFeature } from '@iskra-bun/web-kit';

new SessionFeature({
    store: 'cache',                        // 'memory' | 'cache' | 'db'
    secret: process.env.SESSION_SECRET!,   // required, >= 32 characters
});
```

- To log out, empty the session (`delete c.get('session').userId`) or call `await c.get('destroySession')()`: either way the stored session and the cookie are removed.
- After login, call `await c.get('regenerateSession')()` to issue a new ID and invalidate the old one (prevents session fixation).
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
