---
title: Security & hardening
description: Built-in defenses across Iskra kits — secrets, CSRF, WebSocket authz, email, storage, and HTTP hardening.
---

Iskra ships with secure defaults so the easy path is also the safe one. This guide walks through the protections that are on out of the box and the knobs you should know about.

## Secrets

The auth/web `secret` must be at least **32 characters**. `createBetterAuth` throws at boot if it is missing or too short, so a weak secret never reaches production silently:

```typescript
// packages/auth-kit — createBetterAuth validates length
// throws: "auth secret must be at least 32 characters; received 8"
```

Always pull secrets from the environment, never hardcode them:

```typescript
// app.config.ts
export default {
    auth: {
        secret: process.env.AUTH_SECRET, // >= 32 chars, or boot fails
    },
};
```

The logger redacts sensitive fields automatically. Keys matching `password`, `pass`, `apiKey`, `apiSecret`, `token`, `authToken`, `secret`, `config.env`, and any `*.data` are replaced with `[REDACTED]` before anything is written:

```typescript
app.logger.info({ password: 'hunter2', token: 'abc' }, 'login');
// → { password: '[REDACTED]', token: '[REDACTED]' }
```

## CSRF protection

The CSRF feature uses an HMAC-signed double-submit cookie (OWASP pattern). The token is `<random>.<hmac>`, and verification uses a constant-time comparison (`timingSafeEqual`) so signatures can't be brute-forced by timing:

```typescript
import { CsrfFeature } from '@iskra-bun/web-kit';

new CsrfFeature({
    secret: process.env.CSRF_SECRET, // required, or it throws
    // cookieName defaults to "_csrf", headerName to "X-CSRF-Token"
});
```

Cookies default to `httpOnly`, `secure`, `sameSite: 'Strict'`. There is a `disableCSRFCheck` kill-switch for local development, but it is **ignored in production** — even if a config ships with it enabled, it is neutralized whenever `NODE_ENV === 'production'`:

```typescript
const disableCSRFCheck = process.env.NODE_ENV !== 'production'
    ? this.config.disableCSRFCheck === true
    : false; // always false in prod
```

## WebSocket authorization

`socket-kit` exposes `canJoin` and `canPublish` hooks to gate room access and publishing per connection:

```typescript
import { SocketDriver } from '@iskra-bun/socket-kit';

new SocketDriver({
    canJoin: (connection, room) => isMember(connection.data.userId, room),
    canPublish: (connection, topic) => canWrite(connection.data.userId, topic),
    maxPayloadLength: 16 * 1024, // 16 KiB default — caps frame size
    rateLimit: 100,              // messages per window (default 100)
    rateWindowMs: 1000,          // window length (default 1000ms)
});
```

`maxPayloadLength` bounds frame size and the per-connection rate limit drops connections that exceed their message budget, protecting against floods.

## Email

The SMTP provider is TLS-by-default. STARTTLS is required on non-465 ports (`requireTLS: true`) and certificates are always validated (`rejectUnauthorized: true`):

```typescript
// mailer-kit SMTP — TLS enforced, certs validated
nodemailer.createTransport({
    host, port,
    secure,                        // implicit TLS on 465
    requireTLS: secure ? undefined : true,
    tls: { rejectUnauthorized: true },
});
```

The Mailgun provider applies a strict header allowlist and strips CRLF from values to prevent header injection. Only these headers are accepted: `reply-to`, `in-reply-to`, `references`, `list-unsubscribe`, `list-unsubscribe-post`, `list-id`, `x-mailgun-variables`, `x-mailgun-tag`. Anything else throws:

```typescript
// throws: Header "x-evil" is not allowed
```

## Storage

The local adapter blocks path traversal: keys are sanitized and resolved against `basePath`, and any key that escapes the storage root is rejected:

```typescript
// storage-kit local adapter
// throws: "Path escapes storage root: ../../etc/passwd"
```

The S3 adapter refuses plaintext (`http://`) endpoints unless you explicitly opt out with `useSSL: false`:

```typescript
// throws: "Refusing plaintext S3 endpoint; set useSSL:false to override"
new S3Adapter({
    connection: { endpoint: 'https://s3.example.com' /* useSSL defaults on */ },
});
```

## HTTP hardening

The health endpoint hides internal details by default. `includeDetails` defaults to `false`, so feature lists, DB checks, and raw errors (which may embed connection strings) are never serialized to clients unless you explicitly opt in:

```typescript
import { HealthCheckFeature } from '@iskra-bun/web-kit';

new HealthCheckFeature({ includeDetails: false }); // default
```

API keys are hashed with SHA-256 before being used as cache keys, so the plaintext secret is never persisted where a cache dump could leak it:

```typescript
// api-key feature
const hash = createHash('sha256').update(key).digest('hex');
const cacheKey = `apikey:${hash}`;
```

OAuth/OIDC flows enable PKCE by default. Disabling it exposes authorization-code interception and requires an explicit `pkce: false`:

```typescript
// auth-kit OIDC — PKCE on unless explicitly disabled
pkce: oidcConfig.pkce !== undefined ? oidcConfig.pkce : true,
```
