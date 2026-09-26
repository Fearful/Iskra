---
title: SDKs
description: Official clients for consuming Iskra from other languages through its HTTP API.
---

Iskra is a TypeScript/Bun framework, but it can be consumed from any language through its HTTP API. The official SDKs provide typed clients that simplify this integration.

## Strategy

Iskra is deployed as an HTTP service (via `@iskra-bun/web-kit`) and the SDKs act as lightweight clients that wrap the HTTP calls with an idiomatic API for each language.

```
┌──────────────────────┐     ┌──────────────────────┐
│    Tu App (Java,     │     │   Servicio Iskra     │
│    Python, Go, etc.) │────>│   (Bun/TypeScript)   │
│                      │HTTP │                      │
│    usa: iskra-client │     │   WebPlugin + Kernel │
└──────────────────────┘     └──────────────────────┘
```

## Available SDKs

| Language | Package | Location | Status |
|----------|---------|-----------|--------|
| **Java** | `dev.iskra:iskra-client` | [`sdks/java/iskra-client`](https://github.com/fearful/iskra/tree/main/sdks/java/iskra-client/) | v0.2.0 |
| **Python** | `iskra-client` | [`sdks/python/iskra-client`](https://github.com/fearful/iskra/tree/main/sdks/python/iskra-client/) | v0.2.0 |

## Java SDK

Client for Java 11+ compatible with Spring MVC, Spring Boot, Jakarta EE, and any Java application.

**Features:**
- Builder pattern for configuration
- Sub-clients for Auth, Health, and Storage
- Generic GET/POST/PUT/DELETE methods for custom routes
- Automatic mapping of Iskra errors to typed Java exceptions
- Single external dependency: Jackson (JSON)

**Installation (Maven):** the SDK is not on Maven Central yet, so install it from source first (`mvn install` in `sdks/java/iskra-client` of a clone of this repository), then add:
```xml
<dependency>
    <groupId>dev.iskra</groupId>
    <artifactId>iskra-client</artifactId>
    <version>0.2.0</version>
</dependency>
```

**Basic usage:**
```java
var iskra = IskraClient.builder("http://iskra-service:3000")
    .apiKey("sk-xxx")
    .build();

// Rutas personalizadas
var resultado = iskra.post("/api/ordenes", datos, Orden.class);
var pagina = iskra.get("/api/productos", Map.of("pagina", 2), List.class);  // ?pagina=2

// Sub-clientes
iskra.health().check();
Session session = iskra.auth().signIn(email, password).getData();
iskra.withSession(session).storage().upload(path, "archivo.pdf");
```

Full documentation: [`sdks/java/iskra-client/README.md`](https://github.com/fearful/iskra/tree/main/sdks/java/iskra-client/README.md)

## Python SDK

Client for Python 3.9+ compatible with FastAPI, Django, Flask, and any Python application. Supports synchronous and asynchronous operations.

**Features:**
- Sync and async support (httpx)
- Sub-clients for Auth, Health, and Storage
- Generic GET/POST/PUT/DELETE methods for custom routes
- Automatic mapping of Iskra errors to typed Python exceptions
- Context manager (`with` / `async with`)
- Single external dependency: httpx

**Installation:** the SDK is not on PyPI yet, so install it from source:
```bash
pip install "git+https://github.com/fearful/iskra.git#subdirectory=sdks/python/iskra-client"
# or, from a clone of this repository:
pip install -e sdks/python/iskra-client
```

**Basic usage:**
```python
from iskra_client import IskraClient

iskra = IskraClient(
    base_url="http://iskra-service:3000",
    api_key="sk-xxx",
)

# Rutas personalizadas
resultado = iskra.post("/api/ordenes", json=datos)
pagina = iskra.get("/api/productos", params={"pagina": 2})  # ?pagina=2

# Sub-clientes
iskra.health.check()
session = iskra.auth.sign_in(email, password).data
iskra.with_session(session).storage.upload(path, "archivo.pdf")

# Async
resultado = await iskra.async_get("/api/productos")
```

Full documentation: [`sdks/python/iskra-client/README.md`](https://github.com/fearful/iskra/tree/main/sdks/python/iskra-client/README.md)

## Sessions

Both SDKs are meant to run inside a backend that serves many users, so a client
**never stores cookies**: the session of one user cannot leak into another user's
requests. `sign_in` / `signIn` (and `sign_up` / `signUp`) return a `Session` whose
`cookie` authenticates that user. Keep it server-side (for example in your own
HttpOnly cookie) and bind it per request:

```python
session = iskra.auth.sign_in(email, password).data
as_user = iskra.with_session(session)        # or with_session(session.cookie)
as_user.get("/api/my-orders")
iskra.auth.sign_out(session)
```

```java
Session session = iskra.auth().signIn(email, password).getData();
IskraClient asUser = iskra.withSession(session);   // or withSession(session.getCookie())
asUser.get("/api/my-orders", Map.class);
iskra.auth().signOut(session);
```

- Only Better Auth's `session_token` cookie is kept (its `session_data` cache
  cookie would keep a signed-out session valid until it expires).
- Session requests send `Origin` = the base URL's origin, which Better Auth
  requires for cookie-authenticated POSTs. If the service's AuthFeature `baseURL`
  is a different (public) URL, set `origin` in the client or add the base URL to
  `trustedOrigins`.
- The AuthFeature limits auth attempts (sign-in, sign-up...) to 20 per 15
  minutes per IP. A backend makes them all from its own IP, so that limit throttles
  all its users together: raise it with `rateLimit: { max, windowMs }` and limit
  per user in the backend (by client IP or email), which the SDKs do not do.
  `rateLimit: false` leaves password guessing unthrottled: use it only when the
  backend already has such a limit.
- A 429 raises `RateLimitException`. When the response has a `Retry-After` header
  (seconds or an HTTP-date), the wait is in `e.retry_after` (Python, seconds as a
  float) or `e.getRetryAfter()` (Java, `Optional<Duration>`); it is `None` / empty
  when the header is absent or invalid, as with web-kit's own rate limits, which
  do not send one.
- The storage client calls UploadFeature's routes, which usually require a
  signed-in user: use it on `with_session(...)` / `withSession(...)`. Every user
  shares the project's files, so an `authorize` that only checks for a session lets
  anyone list, download and delete everyone's files: scope each user to a folder
  of their own in `authorize` (e.g. require the subfolder to be `users/<user.id>`;
  the SDK READMEs show it).
- `timeout` bounds each request as a whole (connecting, sending, headers and body),
  not each read, so a server trickling bytes cannot hold a call open; the Python SDK
  also stops reading a response body past `max_response_bytes` (10 MiB by default).

Both SDKs are tested against a real Iskra service,
[`sdks/contract/server.ts`](https://github.com/fearful/iskra/tree/main/sdks/contract/server.ts),
so their parsing follows what the service actually returns.

## Preparing your Iskra Service for SDKs

So that your Iskra application is consumable by the SDKs, make sure to:

1. **Use `WebPlugin`** with the features you need (Auth, Health, etc.)
2. **Use `successResponse()` and `errorResponse()`** in your custom routes to maintain the standard response format
3. **Enable `ApiKeyFeature`** if you need API key authentication from the clients
4. **Enable `HealthCheckFeature`** so that clients can verify availability
5. **Enable `CorsFeature`** if the clients connect from different origins

Minimal example of an Iskra service ready for SDKs:

```typescript
import { App } from '@iskra-bun/core';
import { WebPlugin, HealthCheckFeature, ApiKeyFeature, ErrorHandlerFeature } from '@iskra-bun/web-kit';
import { successResponse } from '@iskra-bun/web-kit';
import { Hono } from 'hono';

const router = new Hono();

router.get('/api/productos', (c) => {
    return c.json(successResponse([{ id: 1, nombre: 'Widget' }]));
});

const app = new App({ name: 'MiServicio' });

app.register(new WebPlugin({
    port: 3000,
    router,
    features: [
        new ErrorHandlerFeature(),
        new HealthCheckFeature(),
        new ApiKeyFeature({
            staticKeys: [{ key: 'sk-mi-clave', name: 'java-client' }]
        })
    ]
}));

app.start();
```

## Other Integration Methods

In addition to the HTTP SDKs, Iskra supports integration with other languages via:

| Method | Kit | Description |
|--------|-----|-------------|
| **Process Kit (IPC)** | `@iskra-bun/process-kit` | Iskra runs external processes (Python, Java, binaries) and communicates via JSON-over-stdio |
| **Redis/BullMQ** | `@iskra-bun/kv-kit`, `@iskra-bun/worker-kit` | Both services connect to shared infrastructure for asynchronous communication |
| **WebSocket** | `@iskra-bun/socket-kit` | Real-time bidirectional communication from any language |

See [Process Kit](/packages/process-kit) for integration via processes and the `python-data-processor` template for a complete example.

## Future SDKs

| Language | Package | Status |
|----------|---------|--------|
| Go | `github.com/client-go` | Planned |
| .NET | `Iskra.Client` (NuGet) | Planned |
