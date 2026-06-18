---
title: Web Kit
description: Servidor HTTP basado en Hono con un sistema modular de features.
---

El web-kit provee un servidor HTTP basado en Hono con un sistema modular de features.

## Inicio Rapido

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

El `Kernel` es el micro-kernel que orquesta las features web:

- Resuelve dependencias entre features (sort topologico)
- Detecta dependencias circulares
- Aplica headers de seguridad automaticamente
- Maneja el ciclo de vida (init, start, shutdown)

## Features Disponibles

| Feature | Descripcion |
|---------|-------------|
| `AuthFeature` | Autenticacion con Better Auth (OIDC, email/password) |
| `CorsFeature` | Control de origenes (CORS) |
| `CsrfFeature` | Proteccion CSRF con tokens |
| `RateLimitFeature` | Limitacion de requests (memory o Redis) |
| `ApiKeyFeature` | Validacion de API keys con cache y scopes |
| `ValidationFeature` | Validacion de request con Zod |
| `DbFeature` | Integracion con Drizzle ORM |
| `CacheFeature` | Cache con Redis o memoria |
| `SessionFeature` | Sesiones (DB, cache, o memoria) |
| `PermissionsFeature` | RBAC (roles y permisos) |
| `HealthFeature` | Health checks (readiness/liveness) |
| `OpenAPIFeature` | Documentacion Swagger/OpenAPI |
| `LoggerFeature` | Logging de request/response |
| `ErrorHandlerFeature` | Manejo centralizado de errores |
| `RequestIdFeature` | Tracking de request con ID unico |
| `TracingFeature` | Observabilidad |
| `UploadFeature` | Subida de archivos |
| `StorageFeature` | Almacenamiento de archivos (local) |
| `EmailFeature` | Envio de emails (SMTP, SendGrid) |

## Errores HTTP

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

El `ErrorHandlerFeature` captura estos errores automaticamente y los devuelve como JSON.

## Configuracion de Seguridad

El Kernel aplica headers de seguridad por defecto:

- `Content-Security-Policy`
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Strict-Transport-Security` (HSTS)
- `Permissions-Policy`

Se pueden personalizar via `KernelConfig.security`.

## Respuestas Estandarizadas

```typescript
import { successResponse, errorResponse } from '@iskra-bun/web-kit';

// Exito
return c.json(successResponse({ id: 1, name: 'Juan' }, 'Creado'));
// { success: true, data: { id: 1, name: 'Juan' }, message: 'Creado' }

// Error
return c.json(errorResponse('No encontrado', 'NOT_FOUND'), 404);
// { success: false, error: 'No encontrado', code: 'NOT_FOUND', timestamp: '...' }
```
