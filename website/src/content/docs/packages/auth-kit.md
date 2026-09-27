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

In production (`NODE_ENV=production`) it also throws for a secret that is still a sample value: one containing `change-me`, `dev-secret`, `dev-only`, `your-secret` or `placeholder`, compared without case, `-`, `_`, `.` or spaces (so `changeme` and `CHANGE_ME` count too). Such a secret is public, and it signs the session cookie cache, which is trusted without a database lookup: anyone who knows it can forge a session for any user. The error names the matching word, never the secret:

```typescript
// NODE_ENV=production
createBetterAuth({ db, adapterType: 'postgres', secret: 'dev-secret-change-me-min-32-characters-long' });
// throws: auth secret looks like a placeholder (it contains "change-me"); ...
```

Always supply the secret from an environment variable; never hardcode it:

```typescript
const secret = process.env.AUTH_SECRET;
if (!secret) throw new Error('AUTH_SECRET is not configured');

const auth = createBetterAuth({ db, adapterType: 'postgres', secret });
```

## Base URL

`baseURL` is the app's public origin. It decides whether the session cookies are marked `Secure` (only for an https origin) and is always a trusted origin. If omitted, it is read from `BETTER_AUTH_URL`, and outside production it falls back to `http://localhost:3000`. With `NODE_ENV=production` construction **throws** when neither is set, or when the origin is plain `http://` on a host other than `localhost`, `127.0.0.1` or `[::1]`:

```typescript
// NODE_ENV=production
createBetterAuth({ db, adapterType: 'postgres', secret });                                    // throws unless BETTER_AUTH_URL is set
createBetterAuth({ db, adapterType: 'postgres', secret, baseURL: 'http://app.example.com' });  // throws: must use https
createBetterAuth({ db, adapterType: 'postgres', secret, baseURL: 'https://app.example.com' }); // ok
```

The same rule is exported as `resolveAuthBaseURL(baseURL?, who?)`, which returns the origin to use and prefixes its errors with `who` (web-kit's `AuthFeature` uses it).

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
        // optional: authorizationEndpoint, tokenEndpoint, userinfoEndpoint,
        // discoveryEndpoint, scopes
    },
});
```

The endpoints you don't set come from the issuer's discovery document (`discoveryEndpoint`, by default `${issuer}/.well-known/openid-configuration`), so any standards-compliant provider (Keycloak, Auth0, Okta, Entra ID, …) works with just the `issuer`. Set an endpoint only to override the discovered one. Discovery happens once at startup: if the document cannot be fetched then (e.g. the IdP starts after the app), better-auth logs the error and leaves the provider out until the app restarts, so set the three endpoints explicitly if the IdP may be unavailable when the app boots.

The user's fields come from the standard claims (`email`, `name` or `preferred_username`, `picture`, `email_verified`). If your provider uses other claim names, set them in `mapping`; a mapped claim missing from the profile falls back to the standard one, and a mapped `emailVerified` claim counts as verified when it is `true` or `"true"`. A mapped email is verified only by its mapped `emailVerified` claim (or by `email_verified` when it is the same address as `email`), because better-auth links a verified email to the existing local user:

```typescript
oidcConfig: {
    clientId, clientSecret, issuer,
    mapping: { email: 'mail', name: 'displayName', image: 'avatar', emailVerified: 'mail_verified' },
},
```

`jwksEndpoint`, `mapping.id` and `mapping.extraFields` are deprecated and ignored: better-auth takes the JWKS only from the discovery document's `jwks_uri`, the account's identity always comes from the verified `sub` claim, and extra user fields would need better-auth's `user.additionalFields`.

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
# At least 32 random characters, e.g. the output of: openssl rand -base64 32
# (in production a sample value such as "change-me…" is refused)
AUTH_SECRET=
# The app's public origin when baseURL is not passed (https in production)
BETTER_AUTH_URL=
```
