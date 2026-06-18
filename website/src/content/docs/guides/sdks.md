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
| **Java** | `dev.iskra:iskra-client` | [`sdks/java/iskra-client`](https://github.com/fearful/iskra/tree/main/sdks/java/iskra-client/) | v0.1.0 |
| **Python** | `iskra-client` | [`sdks/python/iskra-client`](https://github.com/fearful/iskra/tree/main/sdks/python/iskra-client/) | v0.1.0 |

## Java SDK

Client for Java 11+ compatible with Spring MVC, Spring Boot, Jakarta EE, and any Java application.

**Features:**
- Builder pattern for configuration
- Sub-clients for Auth, Health, and Storage
- Generic GET/POST/PUT/DELETE methods for custom routes
- Automatic mapping of Iskra errors to typed Java exceptions
- Single external dependency: Jackson (JSON)

**Installation (Maven):**
```xml
<dependency>
    <groupId>dev.iskra</groupId>
    <artifactId>iskra-client</artifactId>
    <version>0.1.0</version>
</dependency>
```

**Basic usage:**
```java
var iskra = IskraClient.builder("http://iskra-service:3000")
    .apiKey("sk-xxx")
    .build();

// Rutas personalizadas
var resultado = iskra.post("/api/ordenes", datos, Orden.class);

// Sub-clientes
iskra.health().check();
iskra.auth().signIn(email, password);
iskra.storage().upload(path, "archivo.pdf");
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

**Installation:**
```bash
pip install iskra-client
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

# Sub-clientes
iskra.health.check()
iskra.auth.sign_in(email, password)
iskra.storage.upload(path, "archivo.pdf")

# Async
resultado = await iskra.async_get("/api/productos")
```

Full documentation: [`sdks/python/iskra-client/README.md`](https://github.com/fearful/iskra/tree/main/sdks/python/iskra-client/README.md)

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

See [Process Kit](/iskra/packages/process-kit) for integration via processes and the `python-data-processor` template for a complete example.

## Future SDKs

| Language | Package | Status |
|----------|---------|--------|
| Go | `github.com/iskra/client-go` | Planned |
| .NET | `Iskra.Client` (NuGet) | Planned |
