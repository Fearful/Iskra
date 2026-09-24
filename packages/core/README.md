# @iskra-bun/core

Nucleo del framework Iskra: clase `App`, inyeccion de dependencias, bus de eventos, logger y manejo de errores. Todos los kits se registran sobre el Core como Drivers o Plugins.

## Instalacion

```bash
bun add @iskra-bun/core
```

## Uso rapido

```typescript
import { App } from '@iskra-bun/core'

const app = new App({ name: 'mi-app' })

app.on('app:started', () => app.logger.info('Listo'))

await app.start()
```

Registra capacidades adicionales con `app.register(driver)` (Drivers) o `app.use(plugin)` (Plugins).

## Documentacion

Guia completa: [@iskra-bun/core](https://iskra-docs.fly.dev/es/packages/core/) · [Arquitectura](https://iskra-docs.fly.dev/es/concepts/architecture/)

## Licencia

AGPL-3.0-or-later
