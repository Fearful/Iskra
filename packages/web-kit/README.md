# @iskra-bun/web-kit

Servidor HTTP de Iskra basado en [Hono](https://hono.dev), con un Kernel de plugins y mas de 15 features integradas (auth, CORS, CSRF, rate limit, DB, cache, sesiones, storage, email, upload, validacion, OpenAPI, permisos, API keys, tracing, health checks).

## Instalacion

```bash
bun add @iskra-bun/web-kit @iskra-bun/core
```

## Uso rapido

```typescript
import { App } from '@iskra-bun/core'
import { WebDriver } from '@iskra-bun/web-kit'

const app = new App({ name: 'mi-api' })
app.register(new WebDriver())

await app.start()
```

Las features se activan a traves de la configuracion del Kernel; revisa la guia para el catalogo completo.

## Documentacion

Guia completa: [docs/web-kit.md](../../docs/web-kit.md)

## Licencia

AGPL-3.0-or-later
