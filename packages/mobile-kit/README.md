# @iskra-bun/mobile-kit

Soporte para plataformas moviles en Iskra. Expone un `MobileDriver` que se integra al ciclo de vida de la `App` para coordinar eventos especificos de movil (deep links, notificaciones push, etc.).

## Instalacion

```bash
bun add @iskra-bun/mobile-kit @iskra-bun/core
```

## Uso rapido

```typescript
import { App } from '@iskra-bun/core'
import { MobileDriver } from '@iskra-bun/mobile-kit'

const app = new App({ name: 'mi-app-movil' })
app.register(new MobileDriver())

await app.start()
```

## Estado (importante)

> ⚠️ El `MobileDriver` actual es un **andamiaje (scaffold)**: se engancha al ciclo de vida de la `App` y emite logs, pero **todavia no implementa la integracion con plataformas moviles** (deep links, push, listeners nativos). El manejo de plataforma de ejemplo vive en el template [`universal-app`](../../templates/universal-app/). Trata este paquete como punto de extension, no como integracion completa.

## Documentacion

Guia completa: [docs/mobile-kit.md](../../docs/mobile-kit.md) · Ejemplo: [templates/universal-app](../../templates/universal-app/)

## Licencia

AGPL-3.0-or-later
