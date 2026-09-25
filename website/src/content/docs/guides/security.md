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

In production (`NODE_ENV=production`) it also refuses a secret that is still a sample value, one containing `change-me`, `dev-secret`, `dev-only`, `your-secret` or `placeholder` (in any case, with or without `-`, `_`, `.` or spaces). Such a secret is public, and it signs the session cookie cache, which is trusted without a database lookup: anyone could forge a session. The `SessionFeature` and `CsrfFeature` secrets need 32 characters too.

Always pull secrets from the environment, never hardcode them:

```typescript
// app.config.ts
export default {
    auth: {
        secret: process.env.AUTH_SECRET, // >= 32 chars, or boot fails
    },
};
```

The logger redacts sensitive fields automatically, at any depth. Keys such as `password`, `pass`, `apiKey`, `apiSecret`, `token`, `authToken`, `accessToken`, `secret`, `clientSecret`, `privateKey`, `authorization`, `cookie`, `setCookie` and `sessionId`, and keys ending in `password`, `secret`, `token`, `apiKey`, `secretKey`, `privateKey` or `accessKey`, are replaced with `[REDACTED]` before anything is written, as are `config.env` and any `*.data`. Keys are compared without case, `-` or `_`, so `api_key`, `X-API-Key` and `DB_PASSWORD` match too:

```typescript
app.logger.info({ password: 'hunter2', headers: { 'x-api-key': 'abc' } }, 'login');
// → { password: '[REDACTED]', headers: { 'x-api-key': '[REDACTED]' } }
```

The same applies to the bindings of child loggers and to the fields of logged errors (an HTTP client's `config.headers.Authorization`, say). In messages, and in error messages and stacks, the password of a `scheme://user:password@host` URL and secret-looking query parameters (`?authToken=`, `&X-Amz-Signature=`) are masked.

## CSRF protection

The CSRF feature uses an HMAC-signed double-submit cookie (OWASP pattern). The token is `<random>.<hmac>`, and verification uses a constant-time comparison (`timingSafeEqual`) so signatures can't be brute-forced by timing:

```typescript
import { CsrfFeature } from '@iskra-bun/web-kit';

new CsrfFeature({
    secret: process.env.CSRF_SECRET, // required, >= 32 characters, or it throws
    trustedOrigins: ['https://admin.example.com'], // other origins whose pages may post
    // cookieName defaults to "__Host-csrf" ("_csrf" if not Secure), headerName to "X-CSRF-Token"
});
```

The token alone does not say who submitted it: a sibling subdomain can set cookies for the parent domain, so it could plant a token it knows and submit it with the victim's session, and `SameSite` does not stop a same-site request. So:

- A state-changing request from another origin is rejected: an `Origin` that is neither the app's own nor in `trustedOrigins` gets 403, and so does a request without `Origin` whose `Sec-Fetch-Site` is `cross-site`.
- The cookie is `__Host-csrf` while it is Secure (the default), a name only the app's own host can set.
- With `SessionFeature`, the token is signed together with the stored session's ID, and `regenerateSession()` issues a new one, so a token from another session is worthless.

Cookies default to `httpOnly`, `secure`, `sameSite: 'Strict'`. `AuthFeature` has a `disableCSRFCheck` kill-switch (for better-auth's own check) for local development, but it is **ignored in production** — even if a config ships with it enabled, it is neutralized whenever `NODE_ENV === 'production'`:

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

`maxPayloadLength` bounds frame size and the per-connection rate limit drops the frames over a connection's message budget, protecting against floods (it logs one warning per window, not one per frame). The hooks are only called with string rooms and topics: a handler that passes a client's value on cannot slip `["global"]` past a deny-list such as `topic !== 'global'`.

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

## Plugins and configuration

Kits, drivers, plugins and web features run with full access to the app, so the Kernel keeps their composition from weakening it: a second feature with a name already registered (a helper called `csrf`, a second `RateLimitFeature`) is refused instead of silently replacing the first, and routes added before `initialize()`, or by a feature in `initialize()` instead of `routes()`, make `initialize()` fail instead of running without the security headers and the other features' middleware.

`new App()` without a config reads `app.config.*` from the working directory (and `.env`). It no longer reads `.apprc` files, and it does not download `extends` layers from `github:`, `gitlab:` or `https://` sources (local `extends` paths still work). For a CLI or desktop binary that runs in directories you don't control, pass the config to `new App({ ... })`.

## HTTP hardening

Rate limits count requests per client IP: the socket address or, with `new Kernel({ trustProxy: n })`, the address the proxies put in `clientIpHeader` (`X-Forwarded-For` by default, `X-Real-IP` if your proxy sets that one). Only that header is read, so a client cannot choose which one counts; IPv6 clients count by /64, and the in-memory counters are capped and swept.

`CorsFeature` with `credentials: true` needs the allowed origins listed: a wildcard `origin` makes `initialize()` throw, instead of sending `Access-Control-Allow-Origin: *` (which browsers reject with credentials) and tempting apps to reflect every origin.

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
