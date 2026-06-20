---
title: Auth Kit
description: Transport-agnostic authentication integration powered by better-auth.
---

Transport-agnostic authentication integration powered by [better-auth](https://www.better-auth.com/). Provides the config factory, the Drizzle auth schema, and the shared types so any service (HTTP or not) can reuse the same session logic.

## Quick Start

```typescript
import { createBetterAuth } from '@iskra-bun/auth-kit';

const auth = createBetterAuth({
    db,                       // instancia de Drizzle
    adapterType: 'postgres',  // 'postgres' | 'mysql' | 'sqlite'
    secret: process.env.AUTH_SECRET!,
    baseURL: 'https://mi-app.com',
});

// Verify the session from any transport
const session = await auth.api.getSession({ headers });
```

## Database adapters

The factory takes a Drizzle instance plus an `adapterType`. It picks the matching schema and builds better-auth's Drizzle adapter:

```typescript
createBetterAuth({ db, adapterType: 'postgres', secret });  // pg
createBetterAuth({ db, adapterType: 'mysql', secret });     // mysql
createBetterAuth({ db, adapterType: 'sqlite', secret });    // sqlite
```

## Email and password

Enabled by default (`enableEmailPassword: true`):

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

## OIDC / generic OAuth

Pass `oidcConfig` to register an OpenID Connect provider:

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

You can also configure better-auth's native social providers via `socialProviders`.

## Drizzle schema

The auth tables (`user`, `session`, `account`, `verification`) are exported per dialect, along with the schema dictionaries:

```typescript
import { pgSchema, mysqlSchema, sqliteSchema } from '@iskra-bun/auth-kit';
```

## Types

`User`, `Account`, `Verification`, `AuthSession`, `SignUpInput`, `SignInInput`, `AuthContext`, and more, for typing handlers and migrations.

## Environment Variables

```bash
AUTH_SECRET=a-key-of-at-least-32-characters
```
