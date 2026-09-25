---
title: Web Kit
description: Servidor HTTP basado en Hono con un sistema modular de features.
---

El web-kit provee un servidor HTTP basado en Hono con un sistema modular de features.

## Inicio Rapido

```typescript
import { App } from '@iskra-bun/core';
import { WebPlugin, CorsFeature, HealthCheckFeature } from '@iskra-bun/web-kit';
import { Hono } from 'hono';

const app = new App({ name: 'MiAPI' });

// Tus rutas, como una app de Hono montada en "/".
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

Una ruta con `schema` valida el request con el; envolvela en `defineRoute()` para que `ctx.body` y `ctx.query` del handler tomen sus tipos del schema (dentro de una lista `routes` comun son `unknown`):

```typescript
import { defineRoute } from '@iskra-bun/web-kit';

defineRoute({
    method: 'POST',
    path: '/api/users',
    schema: { body: z.object({ name: z.string() }) },
    handler: async (ctx) => userService.create(ctx.body.name), // ctx.body.name: string
});
```

Aplica los headers de seguridad por defecto del Kernel (`X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`). El `schema.body` de una ruta se valida sea cual sea el `Content-Type` del request. Los errores lanzados por un handler se registran en el servidor; al cliente solo se le devuelve `{ error: 'Internal Server Error' }` con status 500 (nunca se serializa el mensaje crudo, que podria filtrar connection strings u otros secretos). El cuerpo de los requests se limita a 16 MiB, como en el Kernel (`maxRequestBodySize`; Bun solo permite 128 MiB).

## Kernel

El `Kernel` es el micro-kernel que orquesta las features web:

- Resuelve dependencias entre features (sort topologico)
- Detecta dependencias circulares
- Inicializa todas las features (que registran su middleware) antes de registrar las rutas de cualquiera, asi el middleware de cada feature (CSRF, rate limit, auth, CORS…) se aplica a todas las rutas, sin importar el orden en que se registraron las features
- Rechaza lo que se saltearia ese middleware: rutas agregadas a `getApp()` antes de `initialize()` (agregalas despues de `await kernel.initialize()`, o pasalas como `router` de WebPlugin), rutas que una feature agrega en `initialize()` en vez de `routes()`, y una segunda feature con un nombre ya registrado (antes reemplazaba a la primera en silencio; `RateLimitFeature` acepta un `name` para un segundo limitador)
- Aplica headers de seguridad automaticamente (lo que pases en `securityHeaders` se combina con los valores por defecto); un header que la ruta define por su cuenta, como un `Content-Security-Policy` mas estricto, se respeta
- Maneja el ciclo de vida (init, start, shutdown)

Defaults del servidor, configurables en `new Kernel({ ... })`:

| Opcion | Default | Que hace |
| :--- | :--- | :--- |
| `hostname` | `"0.0.0.0"` | Interfaz donde escucha (todas; `"127.0.0.1"` para solo local) |
| `maxRequestBodySize` | 16 MiB | Tamano maximo del body; por encima Bun responde 413 |
| `idleTimeout` | 10 s (Bun) | Segundos que una conexion puede quedar inactiva |
| `shutdownGraceMs` | 5000 | Cuanto espera `shutdown()` a los requests en curso antes de cerrar las conexiones |
| `logger` | la consola | Donde loguean el Kernel y sus features (ver abajo); `false` para nada |

El Kernel y sus features reportan el arranque, los fallbacks y los errores que manejan a traves de un logger: un objeto con `debug`, `info`, `warn` y `error(message, details?)`. `WebPlugin` le pasa el logger del App salvo que definas `logger`, asi estos mensajes comparten el formato y el nivel de la app (la linea de arranque de cada feature es `debug`). Una feature propia lo obtiene con `kernel.getLogger()` en `initialize()`. `fromStructuredLogger(pinoLogger)` adapta un logger estilo pino.

`shutdown()` deja de aceptar conexiones, espera los requests en curso (hasta `shutdownGraceMs`) y apaga las features en orden inverso de dependencias; si alguna falla, sigue con las demas y al final tira un `AggregateError`.

## Features Disponibles

| Feature | Descripcion |
|---------|-------------|
| `AuthFeature` | Autenticacion con Better Auth (OIDC, email/password) — impulsado por [`@iskra-bun/auth-kit`](/packages/auth-kit/) |
| `CorsFeature` | Control de origenes (CORS) |
| `CsrfFeature` | Proteccion CSRF con tokens |
| `RateLimitFeature` | Limitacion de requests (memory o Redis) |
| `ApiKeyFeature` | Validacion de API keys con scopes |
| `DbFeature` | Integracion con Drizzle ORM |
| `CacheFeature` | Cache con Redis o memoria |
| `SessionFeature` | Sesiones (DB, cache, o memoria) |
| `PermissionsFeature` | RBAC (roles y permisos) |
| `HealthCheckFeature` | Health checks (readiness/liveness) |
| `OpenAPIFeature` | Documentacion Swagger/OpenAPI |
| `LoggerFeature` | Logging de request/response |
| `ErrorHandlerFeature` | Manejo centralizado de errores |
| `RequestIdFeature` | Tracking de request con ID unico |
| `OtelTracingFeature` | Tracing con OpenTelemetry (`@hono/otel`) |
| `UploadFeature` | Subida de archivos |
| `StorageFeature` | Almacenamiento de archivos (local) — impulsado por [`@iskra-bun/storage-kit`](/packages/storage-kit/) |
| `EmailFeature` | Envio de emails (SMTP, SendGrid) — impulsado por [`@iskra-bun/mailer-kit`](/packages/mailer-kit/) |

## Validacion de requests

La validacion es un middleware, no una feature: `validate()` recibe schemas de Zod (v3 o v4) y `validateJson()` JSON Schemas (AJV, con `ajv-formats` y los mensajes de `ajv-errors`). Ambos responden 400 con los errores si la entrada no es valida; si no, el handler lee los datos de `c.get('validated')`, tipados.

```typescript
import { validate, validateJson } from '@iskra-bun/web-kit';

app.post('/users', validate({ body: z.object({ name: z.string() }) }), (c) => {
    const { name } = c.get('validated').body; // string, inferido del schema
    return c.json({ name }, 201);
});

// Un JSON Schema no tiene tipo de TypeScript: nombra la forma validada.
app.post('/orders', validateJson<CreateOrder>({ body: orderSchema }), (c) => c.json(c.get('validated').body));
```

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

Si algun check registrado retorna `false`, lanza una excepcion o tarda mas que `checkTimeoutMs` (por defecto 2000), `/health/ready` responde con **503** (`{ status: "not ready" }`) y registra como warning los nombres de los checks fallidos. Sin checks registrados siempre retorna `ready` (comportamiento anterior).

### Detalles de los endpoints

Por defecto `includeDetails` es **`false`**, para los tres endpoints:

- `/health` responde `{ status, timestamp }`: sin lista de features, resultados por check ni strings de error crudos (los errores se registran en el servidor).
- `/health/ready` responde `{ status }`: los nombres de los checks (`checks`, `failed`) quedan afuera, porque pueden describir la infraestructura (`postgres-primary-10.0.3.12`). El codigo de estado es lo que usa un orquestador.
- `/health/live` responde `{ status, timestamp }`, sin `uptime`.

> **Breaking (0.x):** `/health/ready` y `/health/live` devolvian los nombres de los checks y el uptime sin importar `includeDetails`.

Los checks (ping real a la base de `DbFeature`, cache y `checks` propios) corren siempre, cada uno con un timeout (`checkTimeoutMs`, 2 s por defecto). Si alguno falla, `/health` responde **503** con `{ status: "error" }`, para que el balanceador u orquestador pueda actuar.

Para incluir las features, los resultados y nombres de los checks y el uptime, activa `includeDetails: true`. Como esto revela informacion interna, **gatea los endpoints detras de autenticacion**:

```typescript
const health = new HealthCheckFeature({ includeDetails: true });
// Exponer solo en una ruta protegida — no en el /health publico
```

## Documentacion OpenAPI

`OpenAPIFeature` sirve el spec de las rutas agregadas con `addRoute()` en `/openapi.json`, y una pagina de referencia de la API ([Scalar](https://github.com/scalar/scalar)) en `/docs`:

```typescript
new OpenAPIFeature({
    title: 'Orders API',
    version: '1.0.0',
    servers: [{ url: 'https://api.example.com' }],
    // Ambas rutas: false responde 403, una Response se envia tal cual.
    authorize: (c) => c.get('user')?.role === 'admin',
    // docs: false,   // no sirve ninguna (en produccion, por ejemplo)
    // scalar: false, // sirve /openapi.json sin la pagina
});
```

- La pagina carga una version fija de `@scalar/api-reference` desde jsDelivr, con su hash de Subresource Integrity y `crossorigin="anonymous"`: el navegador rechaza el script si el CDN sirve otra cosa (cargaba `@latest`, asi que lo ultimo que publicara Scalar corria en el origen de la app). Para actualizarlo, o servirlo desde tu propio origen, usa `scalar: { src, integrity }`, donde `integrity` es el hash `sha384-…` de ese archivo exacto.
- La pagina envia su propio `Content-Security-Policy`: scripts solo del origen de ese script, requests solo al origen de la app y a los `servers` del spec ("Try it"), nada mas se carga. Las fuentes web de Scalar y su agente de IA, que envia el spec a los servidores de Scalar, estan apagados. El titulo se escapa como HTML.
- `/openapi.json` y `/docs` se registran en `routes()`, asi que un middleware agregado a la app despues de `initialize()` (un `basicAuth()`, por ejemplo) no corre para ellas: usa `authorize`, que corre para ambas. Devuelve una Response para responder con ella, como un pedido de Basic auth:

```typescript
authorize: (c) => isDocsUser(c) || c.text('Unauthorized', 401, { 'WWW-Authenticate': 'Basic realm="docs"' }),
```

## Tracing

`OtelTracingFeature` crea un span por request con [`@hono/otel`](https://github.com/honojs/middleware/tree/main/packages/otel), a traves de la configuracion de OpenTelemetry de la app (el tracer provider global, o el `tracer` o `tracerProvider` que le pases):

```typescript
new OtelTracingFeature({
    serviceName: 'orders-api',
    ignoreIncomingTraceContext: true, // un servicio expuesto a internet
});
```

- `url.full` se exporta con el valor de los parametros de query con pinta de secreto reemplazado por `REDACTED` (`SECRET_QUERY_PARAMS` de `@iskra-bun/core`: `token`, `access_token`, `api_key`, `code`, `state`…), y lo mismo el token del link `/reset-password/<token>` de better-auth: los links de verificacion de email y de reseteo de contrasena, y las API keys en el query string, llegaban al collector. `redactedQueryParams` define la lista (`[]` conserva todos los valores). Otros tokens en paths se exportan tal cual.
- Por defecto un request continua la traza que nombra su header `traceparent`. `ignoreIncomingTraceContext: true` empieza una traza nueva por request y descarta el `baggage` entrante: en un endpoint publico un cliente podria forzar que sus requests se muestreen y colgarlas de una traza que elija. Deja el default detras de un gateway que define el contexto de traza el mismo.
- Los headers listados en `captureRequestHeaders` se exportan tal cual: no incluyas `authorization` ni `cookie`.

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

El Kernel envia estos headers de seguridad por defecto:

- `X-Frame-Options: SAMEORIGIN`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`

`Content-Security-Policy`, `Strict-Transport-Security` (HSTS) y `Permissions-Policy` son opcionales, y `X-XSS-Protection` esta desactivado. Se configuran con `securityHeaders`, que se combina con los valores por defecto:

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

**Notas de hardening de seguridad:**

- **CSRF (`CsrfFeature`):** double-submit cookie firmada con HMAC-SHA256 bajo el `secret` configurado y comparada en tiempo constante. Un token sin firma o ajeno se rechaza antes de cualquier comparacion. El kill-switch `disableCSRFCheck` se **ignora en produccion** (`NODE_ENV === 'production'`), por lo que la proteccion CSRF no puede desactivarse silenciosamente en un entorno desplegado.
- **API keys (`ApiKeyFeature`):** las keys se comparan con las `staticKeys` configuradas en cada request, asi que quitar, vencer o recortar una key tiene efecto inmediato; no se cachea nada (`enableCache` y `cacheTtl` se ignoran: la entrada cacheada guardaba la key en claro y seguia valiendo despues de revocarla). Los `id` de las API keys son aleatorios (UUID) y no filtran ningun prefijo del secreto. La comparacion de keys es en tiempo constante. Un `Authorization: Bearer` que no es una API key valida no se rechaza globalmente (puede ser un JWT o token de sesion de otro esquema); las rutas que exigen API key usan `requireApiKey()` / `requireScope()`. Una key invalida en el header `X-API-Key` si devuelve 401.
- **CSRF en rutas puntuales:** `requireCsrf()` valida el token en la ruta aunque su metodo este en `ignoreMethods` (p. ej. un GET que modifica estado) y falla cerrado si `CsrfFeature` no esta registrada. En formularios `multipart/form-data` envia el token en el header `X-CSRF-Token`.
- **Uploads (`UploadFeature`):** con `exposeRoutes: true` es obligatorio `authorize(c, action)` (`action`: `upload` | `list` | `download` | `delete`); usa `authorize: () => true` solo si las rutas deben ser publicas. El body se corta al superar `maxFileSize` (413) sin cargarlo entero en memoria, el nombre del archivo se sanea y los errores internos no se devuelven al cliente. `maxFileSize` mas 64 KiB de overhead multipart tiene que entrar en el `maxRequestBodySize` del Kernel (16 MiB por defecto): Bun rechaza bodies mas grandes antes de llegar a la ruta, asi que `initialize()` falla en vez de que el limite nunca se alcance sin aviso.
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
- `baseURL` es el origen publico de la app (por defecto toma `BETTER_AUTH_URL`). Better Auth decide con el el flag `Secure` de las cookies, asi que es **obligatorio en produccion**: sin el se usaba `http://localhost:3000` y las cookies salian sin `Secure`.
- Los intentos de auth (requests `POST` a `{basePath}/*` salvo sign-out: sign-in, sign-up, reset de password…) tienen rate limiting por IP por defecto (20 / 15 min) para frenar credential stuffing; las lecturas de sesion y los callbacks de OAuth no cuentan. En produccion Better Auth aplica ademas sus propios limites por ruta, mas estrictos. El primero se ajusta con `rateLimit: { max, windowMs }`, o `rateLimit: false` apaga los dos si un backend llama a estas rutas en nombre de muchos usuarios desde una sola IP (por ejemplo, con los SDKs) y limita por su cuenta.
- La IP del cliente (para estos limitadores, el `ipAddress` de las sesiones y `RateLimitFeature`) es la del socket. Si la app corre detras de un proxy (nginx, load balancer), configura `new Kernel({ trustProxy: 1 })` con la cantidad de proxies para usar `X-Forwarded-For`; sin eso el header se ignora, porque cualquier cliente puede falsificarlo.
- Las sesiones se validan contra un cache firmado en cookie sin consultar la base, asi que una sesion revocada con sign-out sigue funcionando hasta que ese cache vence: `cookieCacheMaxAge` (segundos, 300 por defecto) define cuanto.
- Usa `requireAuth(kernel)` como middleware para proteger rutas que requieren sesion.

## Sesiones

```typescript
import { SessionFeature } from '@iskra-bun/web-kit';

new SessionFeature({
    store: 'cache',                        // 'memory' | 'cache' | 'db'
    secret: process.env.SESSION_SECRET!,   // requerido, >= 32 caracteres
});
```

- `c.get('session')` es un objeto `SessionData`: sus campos son `unknown` hasta que los declaras (`declare module '@iskra-bun/web-kit' { interface SessionData { userId?: string } }`), y desde ahi quedan tipados en cada request.
- Para cerrar sesion, vacia la sesion (`delete c.get('session').userId`) o llama a `await c.get('destroySession')()`: en ambos casos se borra del store y se elimina la cookie.
- Despues del login llama a `await c.get('regenerateSession')()` para emitir un ID nuevo e invalidar el anterior (evita session fixation).
- Una sesion que destruye una request (logout, `regenerateSession`) no la vuelve a crear otra request que la habia cargado y termina despues. Cada request trabaja sobre su propia copia de los datos de sesion, tambien con el store en memoria, asi que los datos deben poder copiarse con `structuredClone` (para los otros stores ya tenian que ser JSON).
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
