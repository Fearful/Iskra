# @iskra-bun/db-oracle

Soporte para Oracle Database en Iskra a traves de un puente/sidecar (IPC). Permite ejecutar consultas contra Oracle desde una app Iskra sin acoplar el cliente nativo al proceso principal.

## Instalacion

```bash
bun add @iskra-bun/db-oracle @iskra-bun/core
```

## Uso rapido

```typescript
import { App } from '@iskra-bun/core'
import { OracleDriver } from '@iskra-bun/db-oracle'

const app = new App({ name: 'mi-app' })
app.register(new OracleDriver({ /* config del puente */ }))

await app.start()
```

## Estado

Implementacion via puente/sidecar (protocolo request/response sobre un proceso Node). No incluye aun pooling de conexiones ni recuperacion avanzada de errores; ver la guia para los detalles del bridge.

## Documentacion

Guia completa: [docs/db-kit.md](../../docs/db-kit.md)

## Licencia

AGPL-3.0-or-later
