# @iskra-bun/process-kit

Gestion de procesos externos (scripts de Python, binarios) para Iskra. Soporta modos daemon, oneshot y stdio, con ciclo de vida y validacion de configuracion.

## Instalacion

```bash
bun add @iskra-bun/process-kit @iskra-bun/core
```

## Uso rapido

```typescript
import { App } from '@iskra-bun/core'
import { ProcessManager } from '@iskra-bun/process-kit'

const app = new App({ name: 'mi-app' })
app.register(new ProcessManager({ command: 'python', args: ['worker.py'], mode: 'daemon' }))

await app.start()
```

## Documentacion

Guia completa: [@iskra-bun/process-kit](https://iskra-docs.fly.dev/es/packages/process-kit/)

## Licencia

AGPL-3.0-or-later
