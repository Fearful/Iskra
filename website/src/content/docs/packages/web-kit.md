---
title: Web Kit
description: Hono-based HTTP server with a modular feature system.
---

The web-kit provides a Hono-based HTTP server with a modular feature system.

## Quick Start

```typescript
import { App } from '@iskra-bun/core';
import { WebPlugin, CorsFeature, HealthFeature } from '@iskra-bun/web-kit';

const app = new App({ name: 'MiAPI' });

const web = new WebPlugin({
    port: 3000,
    features: [
        new CorsFeature({ origin: '*' }),
        new HealthFeature(),
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
| `HealthFeature` | Health checks (readiness/liveness) |
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

**Security hardening notes:** CSRF tokens are now cryptographically signed (previously unsigned). API key identifiers no longer include the key prefix in responses to reduce accidental exposure.

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
