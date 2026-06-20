# @iskra-bun/auth-kit

Integracion de autenticacion basada en better-auth, agnostica del transporte. Provee la fabrica de configuracion, el esquema Drizzle de auth y los tipos compartidos para que cualquier servicio (HTTP o no) reutilice la misma logica de sesiones.

## Inicio Rapido

```typescript
import { createBetterAuth } from '@iskra-bun/auth-kit';

const auth = createBetterAuth({
    db,                       // instancia de Drizzle
    adapterType: 'postgres',  // 'postgres' | 'mysql' | 'sqlite'
    secret: process.env.AUTH_SECRET!,
    baseURL: 'https://mi-app.com',
});

// Verificar la sesion desde cualquier transporte
const session = await auth.api.getSession({ headers });
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
        // endpoints/scopes/pkce opcionales; se derivan del issuer si no se indican
    },
});
```

Tambien puedes configurar proveedores sociales nativos de better-auth con `socialProviders`.

## Esquema Drizzle

Se exportan las tablas (`user`, `session`, `account`, `verification`) por dialecto y los diccionarios de esquema:

```typescript
import { pgSchema, mysqlSchema, sqliteSchema } from '@iskra-bun/auth-kit';
```

## Tipos

`User`, `Account`, `Verification`, `AuthSession`, `SignUpInput`, `SignInInput`, `AuthContext` y mas, para tipar handlers y migraciones.

## Variables de Entorno

```bash
AUTH_SECRET=una-clave-de-al-menos-32-caracteres
```
