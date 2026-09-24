---
title: Desktop Kit
description: Desktop application support with Tauri.
---

:::caution[Alpha — not yet functional]
`@iskra-bun/desktop-kit` is an **experimental placeholder with no functionality**. The `DesktopDriver` only registers in the `App` lifecycle and logs a warning on start; it does not wrap any Tauri API (windows, IPC, menus), and there is no date for that. The examples below describe a planned API that does not exist yet.
:::

Desktop application support with [Tauri](https://tauri.app). It exposes a `DesktopDriver` that registers with the Core and acts as a bridge between your Iskra App's logic and Tauri's native APIs (windows, IPC, menus).

## Quick Start

```typescript
import { App } from '@iskra-bun/core';
import { DesktopDriver } from '@iskra-bun/desktop-kit';

const app = new App({ name: 'MiAppDeEscritorio' });

app.register(new DesktopDriver());

await app.start();
// Al arrancar solo registra un warning: todavia no hay integracion con Tauri.
```

The `DesktopDriver` implements the Core's `Driver` interface, so it takes part in the standard lifecycle: it is initialized in `app.start()` and released in `app.stop()`.

## DesktopDriver

The driver stores a reference to the `App` during `init()` and is then ready to relay messages between the domain and Tauri's native layer.

```typescript
import { DesktopDriver } from '@iskra-bun/desktop-kit';

const driver = new DesktopDriver();

// driver.name  → 'DesktopDriver'
// driver.init(app)  → guarda la App y prepara el puente
// driver.start()    → activa el puente y loguea el arranque

app.register(driver);
```

| Member | Type | Description |
| :--- | :--- | :--- |
| `name` | `string` | Driver identifier (`'DesktopDriver'`). |
| `init(app)` | `Promise<void>` | Receives the `App` and stores the internal reference. |
| `start()` | `Promise<void>` | Activates the Tauri bridge and emits the startup log. |

## Windows (Window)

Window management is done with the Tauri API (`@tauri-apps/api`). The `DesktopDriver` gives you the hook point; from your handlers you can control the current window.

```typescript
import { getCurrentWindow } from '@tauri-apps/api/window';

const appWindow = getCurrentWindow();

await appWindow.setTitle('Iskra Desktop');
await appWindow.maximize();
await appWindow.setResizable(false);
```

React to window events from the App's bus:

```typescript
app.on('window:focus', async (ctx) => {
    ctx.logger.info('La ventana recupero el foco');
});

const appWindow = getCurrentWindow();
await appWindow.onFocusChanged(({ payload: focused }) => {
    app.emit('window:focus', { focused });
});
```

## IPC (communication with the Rust backend)

Tauri exposes Rust commands to the frontend via `invoke`. Wrap those calls in your App's services to keep the domain decoupled from Tauri.

```typescript
import { invoke } from '@tauri-apps/api/core';

// Llamar a un comando Rust registrado en el backend de Tauri
const usuarios = await invoke<Usuario[]>('listar_usuarios', { activos: true });
```

Register the service in the Core's DI container to reuse it:

```typescript
class DesktopBridge {
    async guardarArchivo(ruta: string, contenido: string) {
        return invoke('guardar_archivo', { ruta, contenido });
    }
}

app.context.set('desktopBridge', new DesktopBridge());

// En cualquier handler
const bridge = app.context.get('desktopBridge');
await bridge.guardarArchivo('notas.txt', 'Hola Iskra');
```

Listen to events emitted from Rust and relay them to the Iskra bus:

```typescript
import { listen } from '@tauri-apps/api/event';

await listen<{ progreso: number }>('descarga:progreso', (evento) => {
    app.emit('descarga:progreso', evento.payload);
});
```

## Menus

Native menus are built with Tauri's menu API. Connect each item to an App event to process it with your handlers.

```typescript
import { Menu, MenuItem } from '@tauri-apps/api/menu';

const itemAcercaDe = await MenuItem.new({
    text: 'Acerca de',
    action: () => app.emit('menu:acerca-de', {}),
});

const menu = await Menu.new({ items: [itemAcercaDe] });
await menu.setAsAppMenu();

app.on('menu:acerca-de', async (ctx) => {
    ctx.logger.info('Abrir dialogo Acerca de');
});
```

## Configuration

The `DesktopDriver` takes no options of its own: all native configuration (window size, permissions, icons) lives in `tauri.conf.json`, Tauri's configuration file.

```jsonc
// tauri.conf.json
{
  "productName": "Iskra Desktop",
  "app": {
    "windows": [
      { "title": "Iskra Desktop", "width": 1024, "height": 768, "resizable": true }
    ]
  }
}
```

The logical name of your Iskra App is still managed from the Core:

```typescript
const app = new App({ name: 'Iskra Desktop', logger: { level: 'info' } });
```

## Complete Example

```typescript
// src/main.ts
import { App } from '@iskra-bun/core';
import { DesktopDriver } from '@iskra-bun/desktop-kit';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';

const app = new App({ name: 'Iskra Desktop' });
app.register(new DesktopDriver());

app.on('archivo:abrir', async (ctx) => {
    const contenido = await invoke<string>('leer_archivo', { ruta: ctx.payload.ruta });
    ctx.logger.info({ bytes: contenido.length }, 'Archivo cargado');
});

async function main() {
    await app.start();

    const ventana = getCurrentWindow();
    await ventana.setTitle('Iskra Desktop');

    app.emit('archivo:abrir', { ruta: 'config.json' });
}

main().catch((err) => app.logger.error({ err }, 'Fallo al arrancar'));
```

For a ready-to-use template, see [`templates/desktop-app`](https://github.com/fearful/iskra/tree/main/templates/desktop-app). If your app also targets mobile, check out [`@iskra-bun/mobile-kit`](/packages/mobile-kit/) and the [`universal-app`](https://github.com/fearful/iskra/tree/main/templates/universal-app) template.
