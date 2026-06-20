---
title: Actualizar a 0.2
description: Cambios incompatibles en la versión 0.2 de los kits de Iskra, con pasos de migración antes/después.
---

La versión 0.2 ajusta varias APIs por claridad y seguridad. Esta guía lista cada cambio incompatible con código antes/después para que actualices de una sola pasada.

## Tabla de versiones

Los kits nuevos debutan en 0.1.0; los kits que cambiaron suben a 0.2.0; el resto recibe un patch.

| Paquete | Versión |
| --- | --- |
| auth-kit, mailer-kit, storage-kit, cache-kit, config-kit | 0.1.0 (nuevos) |
| db-kit, kv-kit, process-kit, socket-kit, worker-kit, web-kit | 0.2.0 |
| core, db-oracle, desktop-kit, mobile-kit | 0.1.1 |

## web-kit: renombre de clases

`WebServer` ahora es `WebDriver`, y `HealthFeature` ahora es `HealthCheckFeature`.

```typescript
// Antes
import { WebServer, HealthFeature } from '@iskra-bun/web-kit';
const web = new WebServer();
app.register(new HealthFeature());

// Después
import { WebDriver, HealthCheckFeature } from '@iskra-bun/web-kit';
const web = new WebDriver();
app.register(new HealthCheckFeature());
```

## kv-kit: el driver se mueve a la config de la app

El driver y la conexión ahora viven en `app.config.kv` (espejando `app.config.db`). `KVManager` solo toma un `namespace` opcional.

```typescript
// Antes
const kv = new KVManager({ driver: 'redis', connection: { url: process.env.REDIS_URL } });

// Después
// app.config.ts
export default {
    kv: {
        driver: 'redis',
        connection: { url: process.env.REDIS_URL },
    },
};

// donde construís el manager
const kv = new KVManager({ namespace: 'app' }); // namespace opcional
```

`KVManager` lee `app.config.kv` durante `init` y elige el adapter desde ahí.

## db-kit: `db` ahora es opcional, usá `ping()`

`DbDriver.db` ahora tiene el tipo `IskraDrizzleDb | undefined` — es `undefined` antes de que el driver se conecte. Para chequeos de liveness usá el nuevo método `ping()` en vez de acceder a `db.db`.

```typescript
// Antes
await db.db.run(sql`SELECT 1`);

// Después
const alive = await db.ping(); // boolean; false si no está conectado
```

`ping()` devuelve `false` en vez de tirar error cuando la conexión está caída, así que es seguro llamarlo en un health check.

## mailer-kit: `sendTemplate()` tira error

El renderizado de templates todavía no está implementado, así que `sendTemplate()` ahora falla ruidosamente en vez de enviar un cuerpo placeholder.

```typescript
// Antes — enviaba algo en silencio
await mailer.sendTemplate('welcome', user.email, { name });

// Después — tira error
// Error: "sendTemplate not supported by smtp"
await mailer.send({ to: user.email, subject: 'Welcome', html: renderWelcome(name) });
```

Armá el cuerpo del mensaje vos mismo y llamá a `send()` hasta que llegue el soporte de templates.

## auth-kit / web-kit: el secreto debe tener >= 32 chars

El `secret` de auth/web ahora se valida en el arranque. Cualquier valor de menos de 32 caracteres tira error antes de que arranque la app.

```typescript
// Antes — se aceptaban secretos cortos
secret: 'dev-secret'

// Después — el arranque falla
// Error: "auth secret must be at least 32 characters; received 10"
secret: process.env.AUTH_SECRET // generá >= 32 chars
```

## socket-kit: envoltorio de `ctx.broadcast`

`ctx.broadcast` (y `broadcastTo`) ahora envuelven el payload en un sobre `{ event, payload }` en el cable. Actualizá los clientes para leer la nueva forma.

```typescript
// Servidor — misma llamada, nuevo formato en el cable
ctx.broadcast('chat:message', { text: 'hi' });

// Antes (cable): { text: 'hi' }
// Después (cable): { event: 'chat:message', payload: { text: 'hi' } }

// Cliente
socket.onmessage = (e) => {
    const { event, payload } = JSON.parse(e.data);
    if (event === 'chat:message') render(payload);
};
```

## web-kit: health `includeDetails` por defecto en false

El endpoint de health ya no expone detalles internos (lista de features, chequeos de DB/cache, errores crudos) por defecto. Poné `includeDetails: true` explícitamente si dependías del comportamiento anterior — pero conviene dejarlo apagado en producción.

```typescript
// Antes — detalles expuestos por defecto
new HealthCheckFeature();

// Después — habilitar explícitamente
new HealthCheckFeature({ includeDetails: true });
```
