# @iskra-bun/kv-kit

Key-Value store de Iskra con adaptadores intercambiables de Redis y memoria.

## Instalacion

```bash
bun add @iskra-bun/kv-kit @iskra-bun/core
```

## Uso rapido

```typescript
import { App } from '@iskra-bun/core'
import { KVManager } from '@iskra-bun/kv-kit'

const app = new App({
  name: 'mi-app',
  kv: { driver: 'redis', connection: process.env.REDIS_URL }, // o { driver: 'memory' }
})
const kv = new KVManager()
app.register(kv)

await app.start()
await kv.set('usuario:123', { name: 'Ana' }, 60) // TTL en segundos
```

El store se elige en la config de la App (`kv.driver`), no en el constructor de `KVManager`. Sin `kv` usa memoria: cada proceso tiene la suya y se pierde al reiniciar (en produccion lo avisa con un warning). La API (`get`/`set`/`del`/`has`, TTL) es identica entre adaptadores.

## Documentacion

Guia completa: [@iskra-bun/kv-kit](https://iskra-docs.fly.dev/es/packages/kv-kit/)

## Licencia

AGPL-3.0-or-later
