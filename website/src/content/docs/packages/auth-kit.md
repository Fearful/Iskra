---
title: Auth Kit
description: Transport-agnostic authentication integration powered by better-auth.
---

Transport-agnostic authentication integration powered by [better-auth](https://www.better-auth.com/). Provides the config factory, the Drizzle auth schema, and the shared types so any service (HTTP or not) can reuse the same session logic.

## Quick Start

```typescript
import { createBetterAuth } from '@iskra-bun/auth-kit';

const auth = createBetterAuth({
    db,                       // Drizzle instance
    adapterType: 'postgres',  // 'postgres' | 'mysql' | 'sqlite'
    secret: process.env.AUTH_SECRET!,  // >= 32 chars, from an env var
    baseURL: 'https://my-app.com',
});

// Verify the session from any transport
const session = await auth.api.getSession({ headers });
```

## Signing secret (required, >= 32 characters)

The `secret` signs sessions, so it **must** be at least 32 characters long. Construction **throws** if the secret is empty or shorter, before better-auth ever sees it, rather than silently building an insecure auth instance:

```typescript
createBetterAuth({ db, adapterType: 'postgres', secret: '' });        // throws
createBetterAuth({ db, adapterType: 'postgres', secret: 'short' });   // throws
```

Always supply the secret from an environment variable; never hardcode it:

```typescript
const secret = process.env.AUTH_SECRET;
if (!secret) throw new Error('AUTH_SECRET is not configured');

const auth = createBetterAuth({ db, adapterType: 'postgres', secret });
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
        // optional endpoints/scopes are derived from the issuer if omitted
    },
});
```

PKCE is **enabled by default** (`pkce: true`) for the generic OAuth/OIDC provider. This protects against authorization-code interception and injection. It is only turned off with an explicit `false`:

```typescript
oidcConfig: {
    clientId, clientSecret, issuer,
    pkce: false,  // explicit opt-out; not recommended
},
```

You can also configure better-auth's native social providers via `socialProviders`.

## Session cookie cache

Sessions use a cookie cache to avoid a database lookup on every request. `cookieCacheMaxAge` (in seconds, default `300` = 5 minutes) controls how long that cache lives. It is also the revocation window: a revoked session keeps passing the cached checks until the entry expires. Lower it to tighten that window, at the cost of more frequent database lookups:

```typescript
const auth = createBetterAuth({
    db,
    adapterType: 'postgres',
    secret,
    cookieCacheMaxAge: 30,  // 30-second revocation window
});
```

## Rate limiting and client IP

In production Better Auth rate-limits its routes per client IP, which it reads from `X-Forwarded-For` by default. When requests reach it without that header, every client shares one limit per route: pass `ipAddressHeaders` with a header your server sets to the real client IP (web-kit's `AuthFeature` does this), or `rateLimit: false` to turn Better Auth's limiter off when the app limits these routes itself:

```typescript
createBetterAuth({ db, adapterType: 'postgres', secret, ipAddressHeaders: ['x-client-ip'] });
createBetterAuth({ db, adapterType: 'postgres', secret, rateLimit: false });
```

## Drizzle schema

The auth tables (`user`, `session`, `account`, `verification`) are exported per dialect, along with the schema dictionaries:

```typescript
import { pgSchema, mysqlSchema, sqliteSchema } from '@iskra-bun/auth-kit';
```

On MySQL, `verification.value` is `text`: it holds the OAuth state, longer than 255 characters. A table created from an earlier version with `varchar(255)` needs `ALTER TABLE verification MODIFY value TEXT NOT NULL` (or a migration generated from the new schema) before OIDC sign-in works.

## Types

`User`, `Account`, `Verification`, `AuthSession`, `SignUpInput`, `SignInInput`, `AuthContext`, and more, for typing handlers and migrations.

## Environment Variables

```bash
# Must be at least 32 characters; use a random, secret value
AUTH_SECRET=replace-with-32-or-more-random-characters
```
