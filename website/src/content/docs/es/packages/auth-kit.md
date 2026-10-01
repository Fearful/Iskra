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

En producción (cualquier `NODE_ENV` salvo `development` y `test`, también sin definir) también lanza un error si el secret sigue siendo un valor de ejemplo: uno que contiene `change-me`, `dev-secret`, `dev-only`, `your-secret` o `placeholder`, comparado sin mayúsculas, `-`, `_`, `.` ni espacios (así que `changeme` y `CHANGE_ME` también cuentan). Un secret así es público, y firma la caché de sesión en cookie, que se acepta sin consultar la base de datos: cualquiera que lo conozca puede falsificar una sesión de cualquier usuario. El error nombra la palabra encontrada, nunca el secret:

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

`baseURL` es el origen público de la app. Decide si las cookies de sesión llevan `Secure` (solo con un origen https) y siempre es un origen confiable. Si no se indica, se lee de `BETTER_AUTH_URL`, y fuera de producción cae en `http://localhost:3000`. En producción la construcción **lanza un error** si no hay ninguno de los dos, o si el origen es `http://` en un host que no sea `localhost`, `127.0.0.1` o `[::1]`:

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

Los endpoints que no indiques salen del documento de discovery del issuer (`discoveryEndpoint`, por defecto `${issuer}/.well-known/openid-configuration`), así que cualquier proveedor que siga el estándar (Keycloak, Auth0, Okta, Entra ID, …) funciona solo con el `issuer`. Indica un endpoint solo para reemplazar el descubierto. El discovery ocurre una vez al arrancar: si en ese momento no se puede obtener el documento (por ejemplo, el IdP arranca después que la app), better-auth registra el error y deja el proveedor afuera hasta que la app se reinicie, así que indica los tres endpoints si el IdP puede no estar disponible cuando arranca la app.

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

## Tokens OAuth: cifrados y renovados

Los tokens de acceso y de refresco de las cuentas sociales y OIDC (GitLab, GitHub, tu proveedor OIDC…) le permiten a quien los tenga actuar como el usuario en ese proveedor. `createBetterAuth` siempre los guarda **cifrados** (`encryptOAuthTokens` de better-auth: AES-256-GCM con una clave derivada de `secret`); no hay opción para desactivarlo.

- Cambiar `secret` deja ilegibles los tokens guardados: sus usuarios vuelven a iniciar sesión con el proveedor.
- El ID token se guarda tal cual.
- **Breaking (0.x):** los tokens que una versión anterior guardó en texto plano pueden dejar de leerse (better-auth toma uno hexadecimal por uno cifrado). Haz que esos usuarios vuelvan a iniciar sesión, o vacía `accessToken` y `refreshToken` en la tabla `account`.

`getProviderAccessToken()` entrega un token de acceso vigente de la cuenta del usuario con un proveedor, y lo renueva con el refresh token cuando está por vencer:

```typescript
import { getProviderAccessToken, OAuthTokenError } from '@iskra-bun/auth-kit';

// En un request: la sesión se lee de los headers (de la base, no de la caché de cookie)
const { accessToken } = await getProviderAccessToken(auth, { providerId: 'gitlab', headers: request.headers });

// En un job de fondo: para un id de usuario
const token = await getProviderAccessToken(auth, { providerId: 'gitlab', userId });
```

| Opción | Por defecto | Descripción |
| :--- | :--- | :--- |
| `providerId` | **obligatoria** | `'gitlab'`, `'github'`, el `providerId` de `oidcConfig`… |
| `headers` | — | Los headers del request; el usuario de su sesión gana sobre `userId` |
| `userId` | — | El usuario por el que se actúa cuando no hay request |
| `accountId` | — | Qué cuenta, cuando el usuario vinculó más de una con ese proveedor |
| `minValidityMs` | `60000` | Renueva cuando al token le queda menos que esto |

- Las renovaciones de una cuenta corren de a una, y cada una vuelve a leer la cuenta antes. Si no, los proveedores que rotan los refresh tokens (GitLab acepta cada uno una sola vez) rechazarían la segunda de dos renovaciones simultáneas y cerrarían la sesión del usuario. Vale dentro de un proceso: varias instancias de la app todavía pueden renovar la misma cuenta a la vez.
- El par renovado se guarda cifrado.
- Sin refresh token, un token por vencer se entrega hasta que vence.

Lanza `OAuthTokenError` con un `code`:

| `code` | Significado | `requiresSignIn` |
| :--- | :--- | :--- |
| `NOT_SIGNED_IN` | `headers` no traen una sesión válida | sí |
| `ACCOUNT_NOT_LINKED` | El usuario no tiene cuenta con ese proveedor | sí |
| `TOKEN_EXPIRED` | Venció y no hay con qué renovarlo | sí |
| `TOKEN_UNREADABLE` | No se puede descifrar (cambió el secret, o es anterior al cifrado) | sí |
| `REFRESH_FAILED` | El proveedor rechazó el refresh token (4xx) | sí |
| `PROVIDER_UNAVAILABLE` | Falló el endpoint de tokens del proveedor (red, 5xx); el par guardado se conserva | no |

En web-kit, [`getAccessToken(c, providerId)`](/es/packages/web-kit/#auth) los responde con 401 o 502.

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
