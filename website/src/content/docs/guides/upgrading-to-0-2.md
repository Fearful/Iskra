---
title: Upgrading to 0.2
description: Breaking changes in the 0.2 release of the Iskra kits, with before/after migration steps.
---

The 0.2 release tightens several APIs for clarity and safety. This guide lists every breaking change with before/after code so you can upgrade in one pass.

## Version table

The new kits debut at 0.1.0; the kits that changed bump to 0.2.0; the rest get a patch.

| Package | Version |
| --- | --- |
| auth-kit, mailer-kit, storage-kit, cache-kit, config-kit | 0.1.0 (new) |
| db-kit, kv-kit, process-kit, socket-kit, worker-kit, web-kit | 0.2.0 |
| core, db-oracle, desktop-kit, mobile-kit | 0.1.1 |

## web-kit: class renames

`WebServer` is now `WebDriver`, and `HealthFeature` is now `HealthCheckFeature`.

```typescript
// Before
import { WebServer, HealthFeature } from '@iskra-bun/web-kit';
const web = new WebServer();
app.register(new HealthFeature());

// After
import { WebDriver, HealthCheckFeature } from '@iskra-bun/web-kit';
const web = new WebDriver();
app.register(new HealthCheckFeature());
```

## kv-kit: driver moves to app config

The driver and connection now live on `app.config.kv` (mirroring `app.config.db`). `KVManager` only takes an optional `namespace`.

```typescript
// Before
const kv = new KVManager({ driver: 'redis', connection: { url: process.env.REDIS_URL } });

// After
// app.config.ts
export default {
    kv: {
        driver: 'redis',
        connection: { url: process.env.REDIS_URL },
    },
};

// where you build the manager
const kv = new KVManager({ namespace: 'app' }); // namespace optional
```

`KVManager` reads `app.config.kv` during `init` and picks the adapter from there.

## db-kit: `db` is now optional, use `ping()`

`DbDriver.db` is now typed `IskraDrizzleDb | undefined` — it is `undefined` before the driver connects. For liveness checks use the new `ping()` method instead of reaching into `db.db`.

```typescript
// Before
await db.db.run(sql`SELECT 1`);

// After
const alive = await db.ping(); // boolean; false if not connected
```

`ping()` returns `false` instead of throwing when the connection is down, so it is safe to call in a health check.

## mailer-kit: `sendTemplate()` throws

Template rendering is not implemented yet, so `sendTemplate()` now fails loudly rather than sending a placeholder body.

```typescript
// Before — silently sent something
await mailer.sendTemplate('welcome', user.email, { name });

// After — throws
// Error: "sendTemplate not supported by smtp"
await mailer.send({ to: user.email, subject: 'Welcome', html: renderWelcome(name) });
```

Build the message body yourself and call `send()` until template support lands.

## auth-kit / web-kit: secret must be >= 32 chars

The auth/web `secret` is now validated at boot. Anything shorter than 32 characters throws before the app starts.

```typescript
// Before — short secrets accepted
secret: 'dev-secret'

// After — boot fails
// Error: "auth secret must be at least 32 characters; received 10"
secret: process.env.AUTH_SECRET // generate >= 32 chars
```

## socket-kit: `ctx.broadcast` envelope

`ctx.broadcast` (and `broadcastTo`) now wrap the payload in an `{ event, payload }` envelope on the wire. Update clients to read the new shape.

```typescript
// Server — same call, new wire format
ctx.broadcast('chat:message', { text: 'hi' });

// Before (wire): { text: 'hi' }
// After  (wire): { event: 'chat:message', payload: { text: 'hi' } }

// Client
socket.onmessage = (e) => {
    const { event, payload } = JSON.parse(e.data);
    if (event === 'chat:message') render(payload);
};
```

## web-kit: health `includeDetails` defaults to false

The health endpoint no longer exposes internal details (feature list, DB/cache checks, raw errors) by default. Set `includeDetails: true` explicitly if you relied on the old behavior — but prefer leaving it off in production.

```typescript
// Before — details exposed by default
new HealthCheckFeature();

// After — opt in explicitly
new HealthCheckFeature({ includeDetails: true });
```
