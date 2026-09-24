---
title: Web Kit
description: Servidor HTTP basado en Hono con un sistema modular de features.
---

El web-kit provee un servidor HTTP basado en Hono con un sistema modular de features.

## Inicio Rapido

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

## WebDriver (servidor standalone)

`WebDriver` es un driver liviano basado en OpenAPIHono para exponer rutas tipadas sin el Kernel de features. Acepta `{ port, routes }` (antes se llamaba `WebServer` — **cambio incompatible**, actualiza tus imports).

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

Aplica los mismos headers de seguridad estandar que el stack HTTP del Kernel. Los errores lanzados por un handler se registran en el servidor; al cliente solo se le devuelve `{ error: 'Internal Server Error' }` con status 500 (nunca se serializa el mensaje crudo, que podria filtrar connection strings u otros secretos).

## Kernel

El `Kernel` es el micro-kernel que orquesta las features web:

- Resuelve dependencias entre features (sort topologico)
- Detecta dependencias circulares
- Aplica headers de seguridad automaticamente (lo que pases en `securityHeaders` se combina con los valores por defecto)
- Maneja el ciclo de vida (init, start, shutdown)

Defaults del servidor, configurables en `new Kernel({ ... })`:

| Opcion | Default | Que hace |
| :--- | :--- | :--- |
| `hostname` | `"0.0.0.0"` | Interfaz donde escucha (todas; `"127.0.0.1"` para solo local) |
| `maxRequestBodySize` | 16 MiB | Tamano maximo del body; por encima Bun responde 413 |
| `idleTimeout` | 10 s (Bun) | Segundos que una conexion puede quedar inactiva |
| `shutdownGraceMs` | 5000 | Cuanto espera `shutdown()` a los requests en curso antes de cerrar las conexiones |

`shutdown()` deja de aceptar conexiones, espera los requests en curso (hasta `shutdownGraceMs`) y apaga las features en orden inverso de dependencias; si alguna falla, sigue con las demas y al final tira un `AggregateError`.

## Features Disponibles

| Feature | Descripcion |
|---------|-------------|
| `AuthFeature` | Autenticacion con Better Auth (OIDC, email/password) — impulsado por [`@iskra-bun/auth-kit`](/packages/auth-kit/) |
| `CorsFeature` | Control de origenes (CORS) |
| `CsrfFeature` | Proteccion CSRF con tokens |
| `RateLimitFeature` | Limitacion de requests (memory o Redis) |
| `ApiKeyFeature` | Validacion de API keys con cache y scopes |
| `ValidationFeature` | Validacion de request con Zod |
| `DbFeature` | Integracion con Drizzle ORM |
| `CacheFeature` | Cache con Redis o memoria |
| `SessionFeature` | Sesiones (DB, cache, o memoria) |
| `PermissionsFeature` | RBAC (roles y permisos) |
| `HealthCheckFeature` | Health checks (readiness/liveness) |
| `OpenAPIFeature` | Documentacion Swagger/OpenAPI |
| `LoggerFeature` | Logging de request/response |
| `ErrorHandlerFeature` | Manejo centralizado de errores |
| `RequestIdFeature` | Tracking de request con ID unico |
| `TracingFeature` | Observabilidad |
| `UploadFeature` | Subida de archivos |
| `StorageFeature` | Almacenamiento de archivos (local) — impulsado por [`@iskra-bun/storage-kit`](/packages/storage-kit/) |
| `EmailFeature` | Envio de emails (SMTP, SendGrid) — impulsado por [`@iskra-bun/mailer-kit`](/packages/mailer-kit/) |

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

### Detalles del endpoint /health

Por defecto `includeDetails` es **`false`** (cambio respecto a versiones previas). El endpoint `/health` sin autenticar ya no expone la lista interna de features ni strings de error crudos: los errores se registran en el servidor y la respuesta es generica (`{ status: "ok", timestamp }`).

Los checks (ping real a la base de `DbFeature`, cache y `checks` propios) corren siempre, cada uno con un timeout (`checkTimeoutMs`, 2 s por defecto). Si alguno falla, `/health` responde **503** con `{ status: "error" }`, para que el balanceador u orquestador pueda actuar.

Para incluir el detalle de features y checks, activa `includeDetails: true`. Como esto revela informacion interna, **gatea el endpoint detras de autenticacion**:

```typescript
const health = new HealthCheckFeature({ includeDetails: true });
// Exponer solo en una ruta protegida — no en el /health publico
```

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

**Notas de hardening de seguridad:**

- **CSRF (`CsrfFeature`):** double-submit cookie firmada con HMAC-SHA256 bajo el `secret` configurado y comparada en tiempo constante. Un token sin firma o ajeno se rechaza antes de cualquier comparacion. El kill-switch `disableCSRFCheck` se **ignora en produccion** (`NODE_ENV === 'production'`), por lo que la proteccion CSRF no puede desactivarse silenciosamente en un entorno desplegado.
- **API keys (`ApiKeyFeature`):** la clave de cache es un hash **SHA-256** de la key (la key en claro nunca se persiste en el cache, p. ej. Redis). Los `id` de las API keys son aleatorios (UUID) y no filtran ningun prefijo del secreto. La comparacion de keys es en tiempo constante. Un `Authorization: Bearer` que no es una API key valida no se rechaza globalmente (puede ser un JWT o token de sesion de otro esquema); las rutas que exigen API key usan `requireApiKey()` / `requireScope()`. Una key invalida en el header `X-API-Key` si devuelve 401.
- **CSRF en rutas puntuales:** `requireCsrf()` valida el token en la ruta aunque su metodo este en `ignoreMethods` (p. ej. un GET que modifica estado) y falla cerrado si `CsrfFeature` no esta registrada. En formularios `multipart/form-data` envia el token en el header `X-CSRF-Token`.
- **Uploads (`UploadFeature`):** con `exposeRoutes: true` es obligatorio `authorize(c, action)` (`action`: `upload` | `list` | `download` | `delete`); usa `authorize: () => true` solo si las rutas deben ser publicas. El body se corta al superar `maxFileSize` (413) sin cargarlo entero en memoria, el nombre del archivo se sanea y los errores internos no se devuelven al cliente.
- **Auth (`AuthFeature`):** el `secret` subyacente debe tener **>= 32 caracteres** (validado por `@iskra-bun/auth-kit`); un secreto mas corto o vacio se rechaza al inicializar. Ver la seccion de Auth.

## Auth

`AuthFeature` envuelve Better Auth (impulsado por [`@iskra-bun/auth-kit`](/packages/auth-kit/)) y depende de `DbFeature`. Soporta los modos `email` (email/password) y `oidc`.

```typescript
import { AuthFeature } from '@iskra-bun/web-kit';

new AuthFeature({
    secret: process.env.AUTH_SECRET!, // requerido, >= 32 caracteres
    basePath: '/api/sso',             // default
    authMode: 'email',
});
```

- El `secret` firma las sesiones y **debe tener al menos 32 caracteres**; uno mas corto o vacio lanza un error al inicializar.
- En modo `oidc` (o si se pasa `oidcConfig`) el login email/password queda deshabilitado; activalo explicitamente con `enableEmailPassword: true`. `enableSelfRegistration: false` rechaza `/sign-up/email` (las cuentas se crean por otro medio).
- Las rutas de auth (`{basePath}/*`) tienen rate limiting por IP por defecto (20 intentos / 15 min) para frenar credential stuffing.
- La IP del cliente (para este limitador y para `RateLimitFeature`) es la del socket. Si la app corre detras de un proxy (nginx, load balancer), configura `new Kernel({ trustProxy: 1 })` con la cantidad de proxies para usar `X-Forwarded-For`; sin eso el header se ignora, porque cualquier cliente puede falsificarlo.
- Usa `requireAuth(kernel)` como middleware para proteger rutas que requieren sesion.

## Sesiones

```typescript
import { SessionFeature } from '@iskra-bun/web-kit';

new SessionFeature({
    store: 'cache',                        // 'memory' | 'cache' | 'db'
    secret: process.env.SESSION_SECRET!,   // requerido, >= 32 caracteres
});
```

- Para cerrar sesion, vacia la sesion (`delete c.get('session').userId`) o llama a `await c.get('destroySession')()`: en ambos casos se borra del store y se elimina la cookie.
- Despues del login llama a `await c.get('regenerateSession')()` para emitir un ID nuevo e invalidar el anterior (evita session fixation).
- La cookie es `HttpOnly`, `SameSite=Lax` y `Secure` en produccion (`new Kernel({ environment: 'production' })` o `NODE_ENV=production`); `cookieOptions.secure` lo sobreescribe.

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
