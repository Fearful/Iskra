---
title: Auth Kit
description: Integración de autenticación independiente del transporte, impulsada por better-auth.
---

Integración de autenticación independiente del transporte, impulsada por [better-auth](https://www.better-auth.com/). Proporciona la fábrica de configuración, el esquema Drizzle de autenticación y los tipos compartidos para que cualquier servicio (HTTP o no) pueda reutilizar la misma lógica de sesión.

## Inicio Rapido

```typescript
import { createBetterAuth } from '@iskra-bun/auth-kit';

const auth = createBetterAuth({
    db,                       // instancia de Drizzle
    adapterType: 'postgres',  // 'postgres' | 'mysql' | 'sqlite'
    secret: process.env.AUTH_SECRET!,  // >= 32 caracteres, desde una env var
    baseURL: 'https://mi-app.com',
});

// Verificar la sesión desde cualquier transporte
const session = await auth.api.getSession({ headers });
```

## Secret de firma (obligatorio, >= 32 caracteres)

El `secret` firma las sesiones, por lo que **debe** tener al menos 32 caracteres. La construcción **lanza** un error si el secret está vacío o es más corto, antes de que better-auth lo vea, para no construir una autenticación insegura:

```typescript
createBetterAuth({ db, adapterType: 'postgres', secret: '' });        // lanza error
createBetterAuth({ db, adapterType: 'postgres', secret: 'corto' });   // lanza error
```

En producción (`NODE_ENV=production`) también lanza un error si el secret sigue siendo un valor de ejemplo: uno que contiene `change-me`, `dev-secret`, `dev-only`, `your-secret` o `placeholder`, comparado sin mayúsculas, `-`, `_`, `.` ni espacios (así que `changeme` y `CHANGE_ME` también cuentan). Un secret así es público, y firma la caché de sesión en cookie, que se acepta sin consultar la base de datos: cualquiera que lo conozca puede falsificar una sesión de cualquier usuario. El error nombra la palabra encontrada, nunca el secret:

```typescript
// NODE_ENV=production
createBetterAuth({ db, adapterType: 'postgres', secret: 'dev-secret-change-me-min-32-characters-long' });
// lanza: auth secret looks like a placeholder (it contains "change-me"); ...
```

Provee siempre el secret desde una variable de entorno; nunca lo escribas en el código:

```typescript
const secret = process.env.AUTH_SECRET;
if (!secret) throw new Error('AUTH_SECRET no está configurado');

const auth = createBetterAuth({ db, adapterType: 'postgres', secret });
```

## URL base

`baseURL` es el origen público de la app. Decide si las cookies de sesión llevan `Secure` (solo con un origen https) y siempre es un origen confiable. Si no se indica, se lee de `BETTER_AUTH_URL`, y fuera de producción cae en `http://localhost:3000`. Con `NODE_ENV=production` la construcción **lanza un error** si no hay ninguno de los dos, o si el origen es `http://` en un host que no sea `localhost`, `127.0.0.1` o `[::1]`:

```typescript
// NODE_ENV=production
createBetterAuth({ db, adapterType: 'postgres', secret });                                    // falla salvo que BETTER_AUTH_URL esté definida
createBetterAuth({ db, adapterType: 'postgres', secret, baseURL: 'http://app.example.com' });  // falla: debe usar https
createBetterAuth({ db, adapterType: 'postgres', secret, baseURL: 'https://app.example.com' }); // ok
```

La misma regla se exporta como `resolveAuthBaseURL(baseURL?, who?)`, que devuelve el origen a usar y antepone `who` a sus errores (el `AuthFeature` de web-kit la usa).

## Adaptadores de base de datos

La fábrica recibe una instancia de Drizzle más un `adapterType`. Selecciona el esquema correspondiente y construye el adaptador Drizzle de better-auth:

```typescript
createBetterAuth({ db, adapterType: 'postgres', secret });  // pg
createBetterAuth({ db, adapterType: 'mysql', secret });     // mysql
createBetterAuth({ db, adapterType: 'sqlite', secret });    // sqlite
```

## Email y contraseña

Habilitado por defecto (`enableEmailPassword: true`):

```typescript
const auth = createBetterAuth({
    db,
    adapterType: 'sqlite',
    secret,
    enableEmailPassword: true,
});

await auth.api.signUpEmail({
    body: { email: 'alice@example.com', password: 'super-secreto', name: 'Alice' },
});
```

## OIDC / OAuth genérico

Pasa `oidcConfig` para registrar un proveedor OpenID Connect:

```typescript
const auth = createBetterAuth({
    db,
    adapterType: 'postgres',
    secret,
    oidcConfig: {
        clientId: process.env.OIDC_CLIENT_ID!,
        clientSecret: process.env.OIDC_CLIENT_SECRET!,
        issuer: 'https://idp.example.com',
        // opcionales: authorizationEndpoint, tokenEndpoint, userinfoEndpoint,
        // discoveryEndpoint, scopes
    },
});
```

Los endpoints que no indiques salen del documento de discovery del issuer (`discoveryEndpoint`, por defecto `${issuer}/.well-known/openid-configuration`), así que cualquier proveedor que siga el estándar (Keycloak, Auth0, Okta, Entra ID, …) funciona solo con el `issuer`. Indica un endpoint solo para reemplazar el descubierto.

Los campos del usuario salen de los claims estándar (`email`, `name` o `preferred_username`, `picture`, `email_verified`). Si tu proveedor usa otros nombres de claim, indícalos en `mapping`; si el perfil no trae un claim mapeado se usa el estándar, y un claim `emailVerified` mapeado cuenta como verificado cuando es `true` o `"true"`. Un email mapeado solo lo verifica su claim `emailVerified` mapeado (o `email_verified` cuando es la misma dirección que `email`), porque better-auth vincula un email verificado con el usuario local existente:

```typescript
oidcConfig: {
    clientId, clientSecret, issuer,
    mapping: { email: 'mail', name: 'displayName', image: 'avatar', emailVerified: 'mail_verified' },
},
```

`jwksEndpoint`, `mapping.id` y `mapping.extraFields` están deprecados y se ignoran: better-auth toma el JWKS solo del `jwks_uri` del documento de discovery, la identidad de la cuenta siempre sale del claim `sub` verificado, y los campos extra del usuario necesitarían `user.additionalFields` de better-auth.

PKCE viene **activado por defecto** (`pkce: true`) para el proveedor OAuth/OIDC genérico. Esto protege contra la interceptación e inyección del código de autorización. Solo se desactiva con un `false` explícito:

```typescript
oidcConfig: {
    clientId, clientSecret, issuer,
    pkce: false,  // opt-out explícito; no recomendado
},
```

También puedes configurar los proveedores sociales nativos de better-auth mediante `socialProviders`.

## Caché de cookie de sesión

La sesión usa una caché de cookie para evitar una consulta a la base de datos en cada petición. `cookieCacheMaxAge` (en segundos, por defecto `300` = 5 minutos) controla cuánto vive esa caché. Es también la ventana de revocación: una sesión revocada sigue pasando los chequeos cacheados hasta que la entrada expira. Redúcelo para acortar esa ventana, a costa de más consultas a la base de datos:

```typescript
const auth = createBetterAuth({
    db,
    adapterType: 'postgres',
    secret,
    cookieCacheMaxAge: 30,  // ventana de revocación de 30 segundos
});
```

## Rate limiting e IP del cliente

En producción Better Auth limita sus rutas por IP del cliente, que por defecto lee de `X-Forwarded-For`. Si los requests le llegan sin ese header, todos los clientes comparten un mismo límite por ruta: pasa `ipAddressHeaders` con un header que tu servidor complete con la IP real del cliente (el `AuthFeature` de web-kit lo hace), o `rateLimit: false` para apagar el limitador de Better Auth cuando la app limita esas rutas por su cuenta:

```typescript
createBetterAuth({ db, adapterType: 'postgres', secret, ipAddressHeaders: ['x-client-ip'] });
createBetterAuth({ db, adapterType: 'postgres', secret, rateLimit: false });
```

## Esquema Drizzle

Las tablas de autenticación (`user`, `session`, `account`, `verification`) se exportan por dialecto, junto con los diccionarios de esquema:

```typescript
import { pgSchema, mysqlSchema, sqliteSchema } from '@iskra-bun/auth-kit';
```

En MySQL, `verification.value` es `text`: guarda el estado de OAuth, de más de 255 caracteres. Una tabla creada con una versión anterior (`varchar(255)`) necesita `ALTER TABLE verification MODIFY value TEXT NOT NULL` (o una migración generada con el esquema nuevo) para que funcione el login OIDC.

## Tipos

`User`, `Account`, `Verification`, `AuthSession`, `SignUpInput`, `SignInInput`, `AuthContext` y más, para tipar handlers y migraciones.

## Variables de Entorno

```bash
# Al menos 32 caracteres aleatorios, por ejemplo la salida de: openssl rand -base64 32
# (en producción se rechaza un valor de ejemplo como "change-me…")
AUTH_SECRET=
# El origen público de la app cuando no se pasa baseURL (https en producción)
BETTER_AUTH_URL=
```
