# @iskra-bun/socket-kit

WebSocket nativo de Bun para Iskra, con router de mensajes y broadcast por topics.

## Instalacion

```bash
bun add @iskra-bun/socket-kit @iskra-bun/core
```

## Uso rapido

```typescript
import { App } from '@iskra-bun/core'
import { SocketDriver } from '@iskra-bun/socket-kit'

const app = new App({ name: 'mi-app' })
app.register(new SocketDriver({ port: 3001 }))

await app.start()
```

Define rutas de mensajes con el `SocketRouter` y emite a topics con broadcast; ver la guia para el protocolo.

## Documentacion

Guia completa: [docs/socket-kit.md](../../docs/socket-kit.md)

## Licencia

AGPL-3.0-or-later
