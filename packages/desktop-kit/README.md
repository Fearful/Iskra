# @iskra-bun/desktop-kit

Soporte para apps de escritorio con [Tauri](https://tauri.app) en Iskra. Expone un `DesktopDriver` que se integra al ciclo de vida de la `App` para coordinar la capa nativa (ventanas, IPC, menus).

## Instalacion

```bash
bun add @iskra-bun/desktop-kit @iskra-bun/core
```

## Uso rapido

```typescript
import { App } from '@iskra-bun/core'
import { DesktopDriver } from '@iskra-bun/desktop-kit'

const app = new App({ name: 'mi-app-escritorio' })
app.register(new DesktopDriver())

await app.start()
```

## Estado (importante)

> ⚠️ El `DesktopDriver` actual es un **andamiaje (scaffold)**: se engancha al ciclo de vida de la `App` y emite logs, pero **todavia no envuelve las APIs de Tauri** (invoke/ventanas/menus). La integracion real con Tauri vive, por ahora, en el template [`desktop-app`](../../templates/desktop-app/) (capa `src-tauri/` + IPC). Trata este paquete como punto de extension, no como integracion completa.

## Documentacion

Guia completa: [@iskra-bun/desktop-kit](https://iskra-docs.fly.dev/es/packages/desktop-kit/) · Ejemplo: [templates/desktop-app](../../templates/desktop-app/)

## Licencia

AGPL-3.0-or-later
