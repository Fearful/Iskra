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

const app = new App({ name: 'mi-app' })
app.register(new KVManager({ adapter: 'memory' }))

await app.start()
```

Cambia `adapter: 'redis'` para usar Redis en produccion; la API (`get`/`set`/`del`/`has`, TTL) es identica entre adaptadores.

## Documentacion

Guia completa: [docs/kv-kit.md](../../docs/kv-kit.md)

## Licencia

AGPL-3.0-or-later
