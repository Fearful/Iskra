# @iskra-bun/web-kit

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
| `AuthFeature` | Autenticacion con Better Auth (OIDC, email/password) — impulsado por `@iskra-bun/auth-kit` |
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
| `StorageFeature` | Almacenamiento de archivos (local) — impulsado por `@iskra-bun/storage-kit` |
| `EmailFeature` | Envio de emails (SMTP, SendGrid) — impulsado por `@iskra-bun/mailer-kit` |

## Generic de Schema en DbFeature

`DbFeature` acepta un generic de schema opcional para queries tipados via `c.get("db")`. Omitirlo reproduce el comportamiento anterior sin tipos (compatible hacia atras).

```typescript
import * as schema from './db/schema';

new DbFeature<typeof schema>({ adapter: 'postgres', connection: { connectionString: process.env.DATABASE_URL } })

// En un route handler:
const users = await c.get('db').query.users.findMany();
//                                  ^-- tipado segun tu schema
```

## Readiness Checks en HealthCheckFeature

`/health/ready` ahora ejecuta checks reales en lugar de reportar siempre listo. Registra checks con `addReadinessCheck` o la opcion de configuracion `readinessChecks`:

```typescript
const health = new HealthCheckFeature();

health.addReadinessCheck('db', async () => {
    // retorna true = listo, false o excepcion = no listo
    await db.execute(sql`SELECT 1`);
    return true;
});
```

Si algun check registrado retorna `false` o lanza una excepcion, `/health/ready` responde con **503** e incluye los nombres de los checks fallidos. Sin checks registrados siempre retorna `ready` (comportamiento anterior).

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

**Notas de hardening de seguridad:** Los tokens CSRF ahora estan firmados criptograficamente (antes no firmados). Los identificadores de API keys ya no incluyen el prefijo de la key en las respuestas para reducir exposicion accidental.

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
