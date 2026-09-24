---
title: SDKs
description: Clientes oficiales para consumir Iskra desde otros lenguajes a traves de su API HTTP.
---

Iskra es un framework TypeScript/Bun, pero puede ser consumido desde cualquier lenguaje a traves de su API HTTP. Los SDKs oficiales proporcionan clientes tipados que simplifican esta integracion.

## Estrategia

Iskra se despliega como un servicio HTTP (via `@iskra-bun/web-kit`) y los SDKs actuan como clientes ligeros que envuelven las llamadas HTTP con una API idiomatica para cada lenguaje.

```
┌──────────────────────┐     ┌──────────────────────┐
│    Tu App (Java,     │     │   Servicio Iskra     │
│    Python, Go, etc.) │────>│   (Bun/TypeScript)   │
│                      │HTTP │                      │
│    usa: iskra-client │     │   WebPlugin + Kernel │
└──────────────────────┘     └──────────────────────┘
```

## SDKs Disponibles

| Lenguaje | Paquete | Ubicacion | Estado |
|----------|---------|-----------|--------|
| **Java** | `dev.iskra:iskra-client` | [`sdks/java/iskra-client`](https://github.com/fearful/iskra/tree/main/sdks/java/iskra-client/) | v0.2.0 |
| **Python** | `iskra-client` | [`sdks/python/iskra-client`](https://github.com/fearful/iskra/tree/main/sdks/python/iskra-client/) | v0.2.0 |

## Java SDK

Cliente para Java 11+ compatible con Spring MVC, Spring Boot, Jakarta EE, y cualquier aplicacion Java.

**Caracteristicas:**
- Builder pattern para configuracion
- Sub-clientes para Auth, Health, y Storage
- Metodos genericos GET/POST/PUT/DELETE para rutas personalizadas
- Mapeo automatico de errores Iskra a excepciones Java tipadas
- Unica dependencia externa: Jackson (JSON)

**Instalacion (Maven):**
```xml
<dependency>
    <groupId>dev.iskra</groupId>
    <artifactId>iskra-client</artifactId>
    <version>0.2.0</version>
</dependency>
```

**Uso basico:**
```java
var iskra = IskraClient.builder("http://iskra-service:3000")
    .apiKey("sk-xxx")
    .build();

// Rutas personalizadas
var resultado = iskra.post("/api/ordenes", datos, Orden.class);

// Sub-clientes
iskra.health().check();
Session session = iskra.auth().signIn(email, password).getData();
iskra.withSession(session).storage().upload(path, "archivo.pdf");
```

Documentacion completa: [`sdks/java/iskra-client/README.md`](https://github.com/fearful/iskra/tree/main/sdks/java/iskra-client/README.md)

## Python SDK

Cliente para Python 3.9+ compatible con FastAPI, Django, Flask, y cualquier aplicacion Python. Soporta operaciones sincronas y asincronas.

**Caracteristicas:**
- Soporte sync y async (httpx)
- Sub-clientes para Auth, Health, y Storage
- Metodos genericos GET/POST/PUT/DELETE para rutas personalizadas
- Mapeo automatico de errores Iskra a excepciones Python tipadas
- Context manager (`with` / `async with`)
- Unica dependencia externa: httpx

**Instalacion:**
```bash
pip install iskra-client
```

**Uso basico:**
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
session = iskra.auth.sign_in(email, password).data
iskra.with_session(session).storage.upload(path, "archivo.pdf")

# Async
resultado = await iskra.async_get("/api/productos")
```

Documentacion completa: [`sdks/python/iskra-client/README.md`](https://github.com/fearful/iskra/tree/main/sdks/python/iskra-client/README.md)

## Sesiones

Los dos SDKs estan pensados para correr dentro de un backend que atiende a muchos
usuarios, asi que un cliente **nunca guarda cookies**: la sesion de un usuario no
puede filtrarse a las peticiones de otro. `sign_in` / `signIn` (y `sign_up` /
`signUp`) devuelven un `Session` cuyo `cookie` autentica a ese usuario. Guardalo del
lado del servidor (por ejemplo, en una cookie HttpOnly propia) y asocialo en cada
peticion:

```python
session = iskra.auth.sign_in(email, password).data
como_usuario = iskra.with_session(session)    # o with_session(session.cookie)
como_usuario.get("/api/mis-pedidos")
iskra.auth.sign_out(session)
```

```java
Session session = iskra.auth().signIn(email, password).getData();
IskraClient comoUsuario = iskra.withSession(session);   // o withSession(session.getCookie())
comoUsuario.get("/api/mis-pedidos", Map.class);
iskra.auth().signOut(session);
```

- Solo se conserva la cookie `session_token` de Better Auth (su cookie de cache
  `session_data` mantendria valida una sesion cerrada hasta que expire).
- Las peticiones con sesion envian `Origin` = el origen de la URL base, que Better
  Auth exige en los POST autenticados con cookie. Si el `baseURL` del AuthFeature es
  otra URL (la publica), configura `origin` en el cliente o agrega la URL base a
  `trustedOrigins`.
- El AuthFeature limita las rutas de auth a 20 peticiones cada 15 minutos por IP. Un
  backend que inicia sesion por todos sus usuarios desde una IP deberia subirlo con
  `rateLimit: { max, windowMs }` (o `rateLimit: false` y limitar por su cuenta).
- El cliente de storage usa las rutas del UploadFeature, que normalmente exigen un
  usuario con sesion: usalo desde `with_session(...)` / `withSession(...)`.

Los dos SDKs se testean contra un servicio Iskra real,
[`sdks/contract/server.ts`](https://github.com/fearful/iskra/tree/main/sdks/contract/server.ts),
asi que interpretan lo que el servicio realmente responde.

## Preparar tu Servicio Iskra para SDKs

Para que tu aplicacion Iskra sea consumible por los SDKs, asegurate de:

1. **Usar `WebPlugin`** con las features que necesites (Auth, Health, etc.)
2. **Usar `successResponse()` y `errorResponse()`** en tus rutas personalizadas para mantener el formato de respuesta estandar
3. **Habilitar `ApiKeyFeature`** si necesitas autenticacion por API key desde los clientes
4. **Habilitar `HealthCheckFeature`** para que los clientes puedan verificar la disponibilidad
5. **Habilitar `CorsFeature`** si los clientes se conectan desde diferentes origenes

Ejemplo minimo de un servicio Iskra listo para SDKs:

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

## Otras Formas de Integracion

Ademas de los SDKs HTTP, Iskra soporta integracion con otros lenguajes via:

| Metodo | Kit | Descripcion |
|--------|-----|-------------|
| **Process Kit (IPC)** | `@iskra-bun/process-kit` | Iskra ejecuta procesos externos (Python, Java, binarios) y se comunica via JSON-over-stdio |
| **Redis/BullMQ** | `@iskra-bun/kv-kit`, `@iskra-bun/worker-kit` | Ambos servicios se conectan a infraestructura compartida para comunicacion asincrona |
| **WebSocket** | `@iskra-bun/socket-kit` | Comunicacion bidireccional en tiempo real desde cualquier lenguaje |

Consulta [Process Kit](/es/packages/process-kit) para la integracion via procesos y la plantilla `python-data-processor` para un ejemplo completo.

## SDKs Futuros

| Lenguaje | Paquete | Estado |
|----------|---------|--------|
| Go | `github.com/client-go` | Planificado |
| .NET | `Iskra.Client` (NuGet) | Planificado |
