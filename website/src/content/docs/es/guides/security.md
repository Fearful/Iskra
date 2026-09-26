---
title: Seguridad y hardening
description: Defensas integradas en los kits de Iskra — secretos, CSRF, autz de WebSocket, email, almacenamiento y hardening HTTP.
---

La mayoría de los defaults de Iskra son la opción segura, así que el camino fácil también es el seguro. No todos: algunas features quedan abiertas hasta que las configurás (un `SocketDriver` acepta cualquier origen, cualquier sala y cualquier tópico; la documentación OpenAPI es pública). Esta guía recorre las protecciones que están activas por defecto, dice dónde un default es abierto y nombra las opciones que lo cierran.

## Secretos

El `secret` de auth/web debe tener al menos **32 caracteres**. `createBetterAuth` tira un error en el arranque si falta o es muy corto, así que un secreto débil nunca llega a producción en silencio:

```typescript
// packages/auth-kit — createBetterAuth valida la longitud
// tira: "auth secret must be at least 32 characters; received 8"
```

En producción (`NODE_ENV=production`) también rechaza un secreto que sigue siendo un valor de ejemplo, uno que contiene `change-me`, `dev-secret`, `dev-only`, `your-secret` o `placeholder` (con cualquier mayúscula, con o sin `-`, `_`, `.` o espacios). Un secreto así es público, y firma la caché de sesión en cookie, que se acepta sin consultar la base: cualquiera podría falsificar una sesión. Los secretos de `SessionFeature` y `CsrfFeature` también necesitan 32 caracteres.

Siempre traé los secretos del entorno, nunca los hardcodees:

```typescript
// app.config.ts
export default {
    auth: {
        secret: process.env.AUTH_SECRET, // >= 32 chars, o el arranque falla
    },
};
```

El logger redacta campos sensibles automáticamente, a cualquier profundidad. Claves como `password`, `pass`, `apiKey`, `apiSecret`, `token`, `authToken`, `accessToken`, `secret`, `clientSecret`, `privateKey`, `authorization`, `cookie`, `setCookie` y `sessionId`, y las que terminan en `password`, `secret`, `token`, `apiKey`, `secretKey`, `privateKey` o `accessKey`, se reemplazan por `[REDACTED]` antes de escribir nada, igual que `config.env` y cualquier `*.data`. Las claves se comparan sin mayúsculas, `-` ni `_`, así que `api_key`, `X-API-Key` y `DB_PASSWORD` también coinciden:

```typescript
app.logger.info({ password: 'hunter2', headers: { 'x-api-key': 'abc' } }, 'login');
// → { password: '[REDACTED]', headers: { 'x-api-key': '[REDACTED]' } }
```

Lo mismo aplica a los bindings de los loggers hijos y a los campos de los errores logueados (por ejemplo `config.headers.Authorization` de un cliente HTTP). En los mensajes, y en los mensajes y stacks de los errores, se enmascaran la contraseña de una URL `scheme://usuario:contraseña@host` y los parámetros de query con pinta de secreto (`?authToken=`, `&X-Amz-Signature=`).

## Protección CSRF

El feature de CSRF usa una cookie firmada con HMAC en patrón double-submit (patrón OWASP). El token es `<random>.<hmac>`, y la verificación usa una comparación de tiempo constante (`timingSafeEqual`) para que las firmas no se puedan romper por timing:

```typescript
import { CsrfFeature } from '@iskra-bun/web-kit';

new CsrfFeature({
    secret: process.env.CSRF_SECRET, // requerido, >= 32 caracteres, o tira error
    trustedOrigins: ['https://admin.example.com'], // otros orígenes cuyas páginas pueden hacer POST
    // cookieName por defecto "__Host-csrf" ("_csrf" si no es Secure), headerName por defecto "X-CSRF-Token"
});
```

El token solo no dice quién lo mandó: un subdominio hermano puede setear cookies para el dominio padre, así que podía plantar un token que conoce y mandarlo junto con la sesión de la víctima, y `SameSite` no frena una request del mismo sitio. Por eso:

- Una request que modifica estado desde otro origen se rechaza: un `Origin` que no es el de la app ni está en `trustedOrigins` recibe 403, igual que una request sin `Origin` cuyo `Sec-Fetch-Site` es `cross-site`.
- La cookie es `__Host-csrf` mientras sea Secure (el default), un nombre que solo el propio host de la app puede setear.
- Con `SessionFeature`, el token se firma junto con el ID de la sesión almacenada, y `regenerateSession()` emite uno nuevo, así que un token de otra sesión no sirve.

Las cookies usan por defecto `httpOnly`, `secure`, `sameSite: 'Strict'`. `AuthFeature` tiene un kill-switch `disableCSRFCheck` (para el chequeo propio de better-auth) para desarrollo local, pero se **ignora en producción** — incluso si una config lo trae habilitado, se neutraliza cuando `NODE_ENV === 'production'`:

```typescript
const disableCSRFCheck = process.env.NODE_ENV !== 'production'
    ? this.config.disableCSRFCheck === true
    : false; // siempre false en prod
```

## Autorización de WebSocket

`socket-kit` es **abierto por defecto**: un `SocketDriver` sin opciones acepta conexiones de cualquier origen sin autenticar (registra un warning al arrancar), deja que cualquier cliente se una a cualquier sala y publique en cualquier tópico, `global` incluido, y reemite en el bus de la app todo evento sin handler. Cerralo con `allowedOrigins` y `authenticate` (el handshake), `canJoin` y `canPublish` (por conexión), y `allowedEvents`:

```typescript
import { SocketDriver } from '@iskra-bun/socket-kit';

new SocketDriver({
    allowedOrigins: ['https://app.example.com'], // otros Origin reciben 403 (cross-site WebSocket hijacking)
    authenticate: (req) => redeemTicket(new URL(req.url).searchParams.get('ticket')), // null => 401
    canJoin: (connection, room) => isMember(connection.data.auth, room),
    canPublish: (connection, topic) => canWrite(connection.data.auth, topic),
    allowedEvents: ['presence:ping'],
    maxPayloadLength: 16 * 1024, // 16 KiB por defecto — limita el tamaño de frame
    rateLimit: 100,              // mensajes por ventana (default 100)
    rateWindowMs: 1000,          // duración de la ventana (default 1000ms)
});
```

No autentiques el handshake con un token de larga vida en la URL (`?token=<sesión o JWT>`): la URL queda en los logs de acceso de cada proxy y balanceador del camino. Emití un ticket de corta vida y de un solo uso desde una ruta HTTP autenticada y canjealo en `authenticate`, o usá el header `Sec-WebSocket-Protocol` o la cookie de sesión (la cookie necesita `allowedOrigins`); ver [Socket Kit](/es/packages/socket-kit/).

`maxPayloadLength` acota el tamaño del frame y el rate limit por conexión descarta los frames que superan el presupuesto de mensajes de la conexión, protegiendo contra floods (registra un warning por ventana, no uno por frame). Los hooks solo se llaman con salas y topics string: un handler que reenvía el valor del cliente no puede colar `["global"]` por una lista de denegación como `topic !== 'global'`.

## Email

El proveedor SMTP usa TLS por defecto. STARTTLS es obligatorio en puertos distintos al 465 (`requireTLS: true`) y los certificados siempre se validan (`rejectUnauthorized: true`):

```typescript
// mailer-kit SMTP — TLS forzado, certs validados
nodemailer.createTransport({
    host, port,
    secure,                        // TLS implícito en 465
    requireTLS: secure ? undefined : true,
    tls: { rejectUnauthorized: true },
});
```

El proveedor de Mailgun aplica una allowlist estricta de headers y elimina CRLF de los valores para prevenir inyección de headers. Solo se aceptan estos headers: `in-reply-to`, `references`, `list-unsubscribe`, `list-unsubscribe-post`, `list-id`, `x-mailgun-variables`, `x-mailgun-tag`. Cualquier otro tira error:

```typescript
// tira: Header "x-evil" is not allowed
```

Reply-To se define con `message.replyTo`, cuya dirección se valida como la de un destinatario; un `reply-to` en `headers` tira `Header "reply-to" is not allowed: use message.replyTo`.

## Almacenamiento

El adapter local bloquea el path traversal: las claves se sanitizan y se resuelven contra `basePath`, y cualquier clave que escape de la raíz del storage se rechaza:

```typescript
// storage-kit adapter local
// tira: "Path escapes storage root: ../../etc/passwd"
```

El adapter S3 rechaza endpoints en texto plano (`http://`) salvo que optes explícitamente por `useSSL: false`:

```typescript
// tira: "Refusing plaintext S3 endpoint; set useSSL:false to override"
new S3Adapter({
    connection: { endpoint: 'https://s3.example.com' /* useSSL activo por defecto */ },
});
```

## Procesos hijos

Un hijo de `process-kit` recibe por defecto un entorno mínimo: `PATH`, `HOME`, el locale, `TZ`, el directorio temporal, `NODE_ENV` y similares, más su `env`. `DATABASE_URL`, `AUTH_SECRET`, las claves de la nube y lo que se cargó de `.env` quedan en la app, así que un hijo que corre código de terceros no puede leerlos; listá en `inheritEnv` las variables que un hijo necesita (`true` las pasa todas). `send()` rechaza mensajes cuando más de `maxPendingStdinBytes` (8 MiB) esperan a un hijo que no lee su stdin, en vez de retenerlos todos en memoria.

## Jobs en segundo plano

BullMQ conserva en Redis los jobs terminados con sus datos. `worker-kit` conserva los últimos 1000 jobs completados y los fallidos de los últimos 7 días (hasta 5000) salvo que `removeOnComplete` / `removeOnFail` digan otra cosa, así que los payloads de los jobs (emails, tokens, datos personales) no se acumulan para siempre. Cuando manejes `worker:dead-letter`, registrá los ids del job con el logger de la app, no su `data`.

## Telemetría

Los spans exportan la URL de cada request, y los query strings suelen llevar credenciales. La configuración de OpenTelemetry de `core` (auto-instrumentación HTTP) y `OtelTracingFeature` los exportan con el valor de los parámetros con pinta de secreto (`token`, `access_token`, `api_key`, `code`, `state`, `sig`, `X-Amz-Signature`…) reemplazado por `REDACTED`, y `OtelTracingFeature` además enmascara el `/reset-password/<token>` de better-auth; `redactedQueryParams` define la lista. El log de arranque nombra el endpoint OTLP solo por su origen, y avisa cuando un endpoint remoto es `http://` sin cifrar. En un servicio expuesto a internet, activá `ignoreIncomingTraceContext: true` en `OtelTracingFeature` para que el `traceparent` de un cliente no pueda forzar el muestreo ni colgar sus requests de una traza que elija.

## Plugins y configuración

Los kits, drivers, plugins y features web corren con acceso total a la app, así que el Kernel evita que su composición la debilite: una segunda feature con un nombre ya registrado (un helper llamado `csrf`, un segundo `RateLimitFeature`) se rechaza en vez de reemplazar a la primera en silencio, y las rutas agregadas antes de `initialize()`, o por una feature en `initialize()` en lugar de `routes()`, hacen fallar `initialize()` en vez de quedar sin las cabeceras de seguridad ni el middleware de las demás features.

`new App()` sin configuración lee `app.config.*` del directorio de trabajo (y `.env`). Ya no lee archivos `.apprc` ni descarga capas `extends` desde `github:`, `gitlab:` o `https://` (las rutas locales en `extends` siguen funcionando). Para un CLI o binario de escritorio que corre en directorios que no controlás, pasá la configuración a `new App({ ... })`.

## Hardening HTTP

Los rate limits cuentan requests por IP del cliente: la dirección del socket o, con `new Kernel({ trustProxy: n })`, la que los proxies ponen en `clientIpHeader` (`X-Forwarded-For` por defecto, `X-Real-IP` si tu proxy completa ese). Solo se lee ese header, así que el cliente no puede elegir cuál cuenta; los clientes IPv6 cuentan por /64, y los contadores en memoria tienen un tope y se barren.

`CorsFeature` con `credentials: true` necesita la lista de orígenes permitidos: un `origin` comodín hace que `initialize()` tire un error, en vez de mandar `Access-Control-Allow-Origin: *` (que los navegadores rechazan con credenciales) y tentar a las apps a reflejar cualquier origen.

Los endpoints de health ocultan los detalles internos por defecto. `includeDetails` es `false` por defecto, así que las listas de features, los chequeos de DB, los errores crudos (que pueden incluir connection strings), los nombres de los readiness checks (que pueden nombrar hosts) y el uptime nunca se serializan al cliente salvo que lo habilites explícitamente; el código de estado le sigue diciendo al balanceador u orquestador lo que necesita:

```typescript
import { HealthCheckFeature } from '@iskra-bun/web-kit';

new HealthCheckFeature({ includeDetails: false }); // default
```

La documentación OpenAPI (`/openapi.json`, `/docs`) es pública por defecto. Carga una versión fija de Scalar con su hash de Subresource Integrity, bajo una Content-Security-Policy que solo deja a la página hablar con la app y los servers del spec; protegela con `authorize(c)` (el middleware agregado después de `initialize()` no la cubre) o apagala con `docs: false`.

Las API keys se hashean con SHA-256 antes de usarse como clave de caché, así que el secreto en texto plano nunca se persiste donde un dump de caché podría filtrarlo:

```typescript
// feature de api-key
const hash = createHash('sha256').update(key).digest('hex');
const cacheKey = `apikey:${hash}`;
```

Los flujos OAuth/OIDC habilitan PKCE por defecto. Deshabilitarlo expone la interceptación de códigos de autorización y requiere un `pkce: false` explícito:

```typescript
// auth-kit OIDC — PKCE activo salvo que se deshabilite explícitamente
pkce: oidcConfig.pkce !== undefined ? oidcConfig.pkce : true,
```
