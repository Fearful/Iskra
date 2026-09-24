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

Provee siempre el secret desde una variable de entorno; nunca lo escribas en el código:

```typescript
const secret = process.env.AUTH_SECRET;
if (!secret) throw new Error('AUTH_SECRET no está configurado');

const auth = createBetterAuth({ db, adapterType: 'postgres', secret });
```

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
        // endpoints/scopes opcionales; se derivan del issuer si no se indican
    },
});
```

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

## Esquema Drizzle

Las tablas de autenticación (`user`, `session`, `account`, `verification`) se exportan por dialecto, junto con los diccionarios de esquema:

```typescript
import { pgSchema, mysqlSchema, sqliteSchema } from '@iskra-bun/auth-kit';
```

## Tipos

`User`, `Account`, `Verification`, `AuthSession`, `SignUpInput`, `SignInInput`, `AuthContext` y más, para tipar handlers y migraciones.

## Variables de Entorno

```bash
# Debe tener al menos 32 caracteres; usa un valor aleatorio y secreto
AUTH_SECRET=reemplaza-esto-por-32-caracteres-o-mas
```
