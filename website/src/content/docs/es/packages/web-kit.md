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

- Resuelve dependencias entre features (sort topologico); las `optionalDependencies` de una feature se inicializan antes que ella solo si estan registradas (asi `CsrfFeature` corre despues de `SessionFeature`, sin importar en que orden las registres)
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
| `trustProxy` | `false` | Cantidad de reverse proxies delante de la app (`true` = 1); solo entonces se lee `clientIpHeader` (ver [Rate limiting e IP del cliente](#rate-limiting-e-ip-del-cliente)) |
| `clientIpHeader` | `"x-forwarded-for"` | El header donde esos proxies ponen la direccion del cliente: `"x-forwarded-for"` o `"x-real-ip"` |

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

Si algun check registrado retorna `false`, lanza una excepcion o tarda mas que `checkTimeoutMs` (por defecto 2000), `/health/ready` responde con **503** e incluye los nombres de los checks fallidos. Sin checks registrados siempre retorna `ready` (comportamiento anterior).

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

El `ErrorHandlerFeature` captura estos errores automaticamente y los devuelve como JSON. Loguea los errores del cliente (4xx) con nivel `debug` y los del servidor (5xx) con `error`: cualquier cliente puede provocar tantos 4xx como quiera, y antes llenaban el log de errores.

## Rate limiting e IP del cliente

`RateLimitFeature` y el limitador de las rutas de auth cuentan requests por IP del cliente. Es la direccion del socket, salvo que le indiques al Kernel los proxies que hay delante de la app:

```typescript
new Kernel({
    trustProxy: 1,                     // un proxy: nginx, un load balancer
    clientIpHeader: 'x-forwarded-for', // el default; 'x-real-ip' si el proxy completa ese
});
```

- Solo se lee `clientIpHeader` (**breaking**). Antes `X-Real-IP` se usaba cuando faltaba `X-Forwarded-For`, y eso lo decide el cliente: detras de un proxy que solo completa `X-Real-IP` y deja pasar `X-Forwarded-For`, un `X-Forwarded-For` inventado era un bucket nuevo en cada request. Si tu proxy completa `X-Real-IP` (nginx: `proxy_set_header X-Real-IP $remote_addr`), configura `clientIpHeader: 'x-real-ip'`; con `X-Forwarded-For`, cada proxy tiene que agregarse al final (nginx: `$proxy_add_x_forwarded_for`).
- Los clientes IPv6 se cuentan por su prefijo /64, porque un host suele tener un /64 entero para ir rotando, y `::ffff:192.0.2.1` cuenta como `192.0.2.1`. `clientIpKey(ip)` devuelve esa clave para un limitador propio.
- El store en memoria sigue como maximo `maxKeys` clientes (100 000 por defecto; por encima descarta los mas viejos) y barre los vencidos cada minuto; el limitador de auth acepta `rateLimit: { maxKeys }` y el adapter en memoria de `CacheFeature` `maxEntries`, con el mismo default. Sus timers no mantienen vivo el proceso.

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

Solo `false` desactiva un header por defecto (`xFrameOptions: false`). Una opcion `undefined`, `null` o vacia mantiene el default: antes `xFrameOptions: process.env.X_FRAME_OPTIONS` con la variable sin definir quitaba el header.

**Notas de hardening de seguridad:**

- **CSRF (`CsrfFeature`):** double-submit cookie firmada con HMAC-SHA256 bajo el `secret` configurado y comparada en tiempo constante, mas un chequeo de `Origin`; ver la seccion [CSRF](#csrf). El kill-switch `disableCSRFCheck` de `AuthFeature` se **ignora en produccion** (`NODE_ENV === 'production'`), por lo que la proteccion CSRF de better-auth no puede desactivarse silenciosamente en un entorno desplegado.
- **API keys (`ApiKeyFeature`):** las keys se comparan con las `staticKeys` configuradas en cada request, asi que quitar, vencer o recortar una key tiene efecto inmediato; no se cachea nada (`enableCache` y `cacheTtl` se ignoran: la entrada cacheada guardaba la key en claro y seguia valiendo despues de revocarla). Los `id` de las API keys son aleatorios (UUID) y no filtran ningun prefijo del secreto. La comparacion de keys es en tiempo constante. Un `Authorization: Bearer` que no es una API key valida no se rechaza globalmente (puede ser un JWT o token de sesion de otro esquema); las rutas que exigen API key usan `requireApiKey()` / `requireScope()`. Una key invalida en el header `X-API-Key` si devuelve 401.
- **Scopes de las API keys:** un comodin es un segmento entero, `*` solo o un `:*` final (`users:*` habilita `users:read` y `users:x:y`, no `usersX`); cualquier otro `*` es literal. **Breaking:** un `*` final era un prefijo de texto, asi que `user*` habilitaba `users:read` y `user-admin:delete`.
- **CORS (`CorsFeature`):** `credentials: true` necesita que `origin` nombre los origenes permitidos (una lista o una funcion); con `origin` sin definir o `'*'`, `initialize()` tira un error (**breaking**). Antes mandaba `Access-Control-Allow-Origin: *`, que los navegadores rechazan con credenciales, y la salida habitual era reflejar cualquier origen.
- **Permisos (`PermissionsFeature`):** los permisos y roles de cada usuario se cachean (con `CacheFeature`) durante `cacheTTL` segundos, 60 por defecto (antes una hora): un rol que revocas sigue valiendo ese tiempo. Llama a `await kernel.getFeature('permissions')?.invalidate(userId)` despues de cambiar los roles o permisos de un usuario para descartar la copia cacheada; baja `cacheTTL`, o usa `cachePermissions: false`, para cambiar consultas a la base por una ventana mas corta.
- **CSRF en rutas puntuales:** `requireCsrf()` valida el token en la ruta aunque su metodo este en `ignoreMethods` (p. ej. un GET que modifica estado) y falla cerrado si `CsrfFeature` no esta registrada. En formularios `multipart/form-data` envia el token en el header `X-CSRF-Token`.
- **Uploads (`UploadFeature`):** con `exposeRoutes: true` es obligatorio `authorize(c, action)` (`action`: `upload` | `list` | `download` | `delete`); usa `authorize: () => true` solo si las rutas deben ser publicas. El body se corta al superar `maxFileSize` (413) sin cargarlo entero en memoria, el nombre del archivo se sanea y los errores internos no se devuelven al cliente. `maxFileSize` mas 64 KiB de overhead multipart tiene que entrar en el `maxRequestBodySize` del Kernel (16 MiB por defecto): Bun rechaza bodies mas grandes antes de llegar a la ruta, asi que `initialize()` falla en vez de que el limite nunca se alcance sin aviso.
- **Auth (`AuthFeature`):** el `secret` subyacente debe tener **>= 32 caracteres** (validado por `@iskra-bun/auth-kit`); un secreto mas corto o vacio se rechaza al inicializar, igual que un valor de ejemplo en produccion. Ver la seccion de Auth.

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

- El `secret` firma las sesiones y **debe tener al menos 32 caracteres**; uno mas corto o vacio lanza un error al inicializar. En produccion tambien lo lanza un valor de ejemplo (que contiene `change-me`, `dev-secret`…): ver [auth-kit](/packages/auth-kit/).
- En modo `oidc` (o si se pasa `oidcConfig`) el login email/password queda deshabilitado; activalo explicitamente con `enableEmailPassword: true`. `enableSelfRegistration: false` rechaza `/sign-up/email` (las cuentas se crean por otro medio).
- `baseURL` es el origen publico de la app (por defecto toma `BETTER_AUTH_URL`). Better Auth decide con el el flag `Secure` de las cookies, asi que es **obligatorio en produccion**: sin el se usaba `http://localhost:3000` y las cookies salian sin `Secure`. Por lo mismo, en produccion tiene que ser `https://` (**breaking**); solo `localhost`, `127.0.0.1` y `[::1]` pueden usar http plano (un proxy o docker compose en la misma maquina). Antes se aceptaba un origen `http://`, y las cookies de sesion salian sin `Secure`.
- Los intentos de auth (requests `POST` a `{basePath}/*` salvo sign-out: sign-in, sign-up, reset de password…) tienen rate limiting por IP por defecto (20 / 15 min, los clientes IPv6 por /64) para frenar credential stuffing; las lecturas de sesion y los callbacks de OAuth no cuentan. En produccion Better Auth aplica ademas sus propios limites por ruta, mas estrictos. El primero se ajusta con `rateLimit: { max, windowMs, maxKeys }`, o `rateLimit: false` apaga los dos si un backend llama a estas rutas en nombre de muchos usuarios desde una sola IP (por ejemplo, con los SDKs) y limita por su cuenta.
- La IP del cliente (para estos limitadores, el `ipAddress` de las sesiones y `RateLimitFeature`) es la del socket. Si la app corre detras de un proxy (nginx, load balancer), configura `new Kernel({ trustProxy: 1 })` con la cantidad de proxies para usar la direccion reenviada (`X-Forwarded-For`, o `X-Real-IP` con `clientIpHeader: 'x-real-ip'`: ver [Rate limiting e IP del cliente](#rate-limiting-e-ip-del-cliente)); sin eso esos headers se ignoran, porque cualquier cliente puede falsificarlos.
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
- Despues del login llama a `await c.get('regenerateSession')()` para emitir un ID nuevo e invalidar el anterior (evita session fixation). Con `CsrfFeature` tambien emite un token CSRF nuevo.
- Una sesion que destruye una request (logout, `regenerateSession`) no la vuelve a crear otra request que la habia cargado y termina despues. Al guardar una sesion almacenada, se escribe solo si todavia existe, chequeado y escrito en un solo paso: en memoria de una vez, en Redis con `SET ... XX`, en una base con un `UPDATE` de su fila. Antes chequeaba (`get`) y despues escribia (`set`), y en Redis o una base un logout que caia entre los dos se deshacia. Un `CacheAdapter` propio lo obtiene con `setIfExists()`; sin el, el chequeo sigue siendo una lectura aparte. Cada request trabaja sobre su propia copia de los datos de sesion, tambien con el store en memoria, asi que los datos deben poder copiarse con `structuredClone` (para los otros stores ya tenian que ser JSON).
- `c.get('sessionPersisted')` indica si `sessionId` corresponde a una sesion almacenada: es false para una nueva, que se guarda al final de la request solo si el handler le pone datos.
- La cookie es `HttpOnly`, `SameSite=Lax` y `Secure` en produccion (`new Kernel({ environment: 'production' })` o `NODE_ENV=production`); `cookieOptions.secure` lo sobreescribe.

## CSRF

```typescript
import { CsrfFeature } from '@iskra-bun/web-kit';

new CsrfFeature({
    secret: process.env.CSRF_SECRET!,              // requerido, >= 32 caracteres
    trustedOrigins: ['https://admin.example.com'], // otros origenes cuyas paginas pueden hacer POST aca
});
```

Las requests con un metodo fuera de `ignoreMethods` (`GET`, `HEAD` y `OPTIONS` por defecto) tienen que traer el token, `c.get('csrfToken')`, en el header `X-CSRF-Token` o en un campo `_csrf` del formulario, igual al de la cookie, y venir de las paginas de la propia app:

- Una request cuyo `Origin` no es el de la app ni esta en `trustedOrigins` recibe 403, igual que una sin `Origin` cuyo `Sec-Fetch-Site` es `cross-site`. El `Sec-Fetch-Site: same-origin` del navegador se toma tal cual, asi que un proxy que termina TLS (la app ve `http://`) no rompe los formularios del mismo origen; un navegador que solo manda `Origin` detras de ese proxy necesita el origen publico en `trustedOrigins`. Las requests sin ninguno de los dos headers (otros servidores, clientes de linea de comandos) quedan a cargo del token. **Breaking:** un frontend en otro origen, otro subdominio incluido, tiene que estar en `trustedOrigins`.
- La cookie es `__Host-csrf` mientras sea `Secure` (el default): solo el propio host de la app puede setearla. Como `_csrf`, un subdominio hermano podia setearla para el dominio padre con un token que conoce y mandar ese token, y `SameSite` no frena una request del mismo sitio. Con `cookieOptions.secure: false` es `_csrf`; un `cookieName` que definas se respeta.
- Con `SessionFeature`, una request con una sesion almacenada necesita un token firmado con el ID de esa sesion, asi que se rechaza un token de otra sesion o de una visita anonima; las requests anonimas reciben tokens sin atar. `regenerateSession()` emite un token nuevo, disponible como `c.get('csrfToken')` desde ese momento (renderizalo, o devolvelo a una SPA). **Breaking:** una SPA tiene que volver a leer el token despues de iniciar o cerrar sesion; uno viejo se reemplaza en la siguiente request, y una request no segura que lo trae recibe 403. `CsrfFeature` corre despues de `SessionFeature` sin importar en que orden las registres.
- El `secret` debe tener al menos 32 caracteres (**breaking**): uno corto se puede romper por fuerza bruta offline a partir de un solo token, y con eso falsificar cualquiera.

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
