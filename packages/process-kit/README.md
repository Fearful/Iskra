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

const app = new App({
  name: 'mi-app',
  processes: {
    worker: { command: 'python3', args: ['worker.py'], mode: 'daemon', restartOnCrash: true },
  },
})
app.register(new ProcessManager())

await app.start()
```

Los procesos se declaran en la config de la App (`processes`), no en el constructor de `ProcessManager`.

## Documentacion

Guia completa: [@iskra-bun/process-kit](https://iskra-docs.fly.dev/es/packages/process-kit/)

## Licencia

AGPL-3.0-or-later
