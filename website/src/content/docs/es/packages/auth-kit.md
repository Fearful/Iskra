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
    secret: process.env.AUTH_SECRET!,
    baseURL: 'https://mi-app.com',
});

// Verificar la sesión desde cualquier transporte
const session = await auth.api.getSession({ headers });
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
    },
});
```

También puedes configurar los proveedores sociales nativos de better-auth mediante `socialProviders`.

## Esquema Drizzle

Las tablas de autenticación (`user`, `session`, `account`, `verification`) se exportan por dialecto, junto con los diccionarios de esquema:

```typescript
import { pgSchema, mysqlSchema, sqliteSchema } from '@iskra-bun/auth-kit';
```

## Tipos

`User`, `Account`, `Verification`, `AuthSession`, `SignUpInput`, `SignInInput`, `AuthContext` y más, para tipar handlers y migraciones.

## Variables de Entorno

```bash
AUTH_SECRET=una-clave-de-al-menos-32-caracteres
```
