# @iskra-bun/auth-kit

Integracion de autenticacion basada en better-auth, agnostica del transporte. Provee la fabrica de configuracion, el esquema Drizzle de auth y los tipos compartidos para que cualquier servicio (HTTP o no) reutilice la misma logica de sesiones.

## Inicio Rapido

```typescript
import { createBetterAuth } from '@iskra-bun/auth-kit';

const auth = createBetterAuth({
    db,                       // instancia de Drizzle
    adapterType: 'postgres',  // 'postgres' | 'mysql' | 'sqlite'
    secret: process.env.AUTH_SECRET!,  // >= 32 caracteres, desde una env var
    baseURL: 'https://mi-app.com',
});

// Verificar la sesion desde cualquier transporte
const session = await auth.api.getSession({ headers });
```

## Secret de firma (obligatorio, >= 32 caracteres)

El `secret` firma las sesiones, asi que **debe** tener al menos 32 caracteres. La construccion **lanza** un error si el secret esta vacio o es mas corto, antes de que better-auth lo vea, para no construir una autenticacion insegura:

```typescript
createBetterAuth({ db, adapterType: 'postgres', secret: '' });        // lanza error
createBetterAuth({ db, adapterType: 'postgres', secret: 'corto' });   // lanza error
```

Provee siempre el secret desde una variable de entorno; nunca lo escribas en el codigo:

```typescript
const secret = process.env.AUTH_SECRET;
if (!secret) throw new Error('AUTH_SECRET no esta configurado');

const auth = createBetterAuth({ db, adapterType: 'postgres', secret });
```

## Adaptadores de base de datos

El factory recibe una instancia de Drizzle y un `adapterType`. Internamente selecciona el esquema correcto y construye el adaptador de Drizzle de better-auth.

```typescript
createBetterAuth({ db, adapterType: 'postgres', secret });  // pg
createBetterAuth({ db, adapterType: 'mysql', secret });     // mysql
createBetterAuth({ db, adapterType: 'sqlite', secret });    // sqlite
```

## Email y password

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

## OIDC / OAuth generico

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
        // endpoints/scopes opcionales; se derivan del issuer si no se indican
    },
});
```

PKCE viene **activado por defecto** (`pkce: true`) para el proveedor OAuth/OIDC generico. Esto protege contra la interceptacion e inyeccion del codigo de autorizacion. Solo se desactiva con un `false` explicito:

```typescript
oidcConfig: {
    clientId, clientSecret, issuer,
    pkce: false,  // opt-out explicito; no recomendado
},
```

Tambien puedes configurar proveedores sociales nativos de better-auth con `socialProviders`.

## Cache de cookie de sesion

La sesion usa una cache de cookie para evitar consultas a la base de datos en cada peticion. `cookieCacheMaxAge` (en segundos, por defecto `300` = 5 minutos) controla cuanto vive esa cache. Es tambien la ventana de revocacion: una sesion revocada sigue pasando los chequeos cacheados hasta que la entrada expira. Reducelo para acortar esa ventana, a costa de mas consultas a la base de datos:

```typescript
const auth = createBetterAuth({
    db,
    adapterType: 'postgres',
    secret,
    cookieCacheMaxAge: 30,  // ventana de revocacion de 30 segundos
});
```

## Esquema Drizzle

Se exportan las tablas (`user`, `session`, `account`, `verification`) por dialecto y los diccionarios de esquema:

```typescript
import { pgSchema, mysqlSchema, sqliteSchema } from '@iskra-bun/auth-kit';
```

## Tipos

`User`, `Account`, `Verification`, `AuthSession`, `SignUpInput`, `SignInInput`, `AuthContext` y mas, para tipar handlers y migraciones.

## Variables de Entorno

```bash
# Debe tener al menos 32 caracteres; usa un valor aleatorio y secreto
AUTH_SECRET=reemplaza-esto-por-32-caracteres-o-mas
```
