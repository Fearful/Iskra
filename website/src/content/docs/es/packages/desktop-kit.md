---
title: Desktop Kit
description: Soporte para aplicaciones de escritorio con Tauri.
---

:::caution[Experimental]
`@iskra-bun/desktop-kit` es experimental. Sus APIs pueden cambiar entre versiones.
:::

Soporte para aplicaciones de escritorio con [Tauri](https://tauri.app). Expone un `DesktopDriver` que se registra en el Core y actua como puente entre la logica de tu App de Iskra y las APIs nativas de Tauri (ventanas, IPC, menus).

## Inicio Rapido

```typescript
import { App } from '@iskra-bun/core';
import { DesktopDriver } from '@iskra-bun/desktop-kit';

const app = new App({ name: 'MiAppDeEscritorio' });

app.register(new DesktopDriver());

await app.start();
// El log "DesktopDriver started (Tauri bridge active)" confirma que el puente esta activo.
```

El `DesktopDriver` implementa la interfaz `Driver` del Core, asi que participa del ciclo de vida estandar: se inicializa en `app.start()` y se libera en `app.stop()`.

## DesktopDriver

El driver guarda una referencia a la `App` durante `init()` y queda listo para reenviar mensajes entre el dominio y la capa nativa de Tauri.

```typescript
import { DesktopDriver } from '@iskra-bun/desktop-kit';

const driver = new DesktopDriver();

// driver.name  → 'DesktopDriver'
// driver.init(app)  → guarda la App y prepara el puente
// driver.start()    → activa el puente y loguea el arranque

app.register(driver);
```

| Miembro | Tipo | Descripcion |
| :--- | :--- | :--- |
| `name` | `string` | Identificador del driver (`'DesktopDriver'`). |
| `init(app)` | `Promise<void>` | Recibe la `App` y guarda la referencia interna. |
| `start()` | `Promise<void>` | Activa el puente de Tauri y emite el log de arranque. |

## Ventanas (Window)

La gestion de ventanas se hace con la API de Tauri (`@tauri-apps/api`). El `DesktopDriver` te da el punto de enganche; desde tus handlers podes controlar la ventana actual.

```typescript
import { getCurrentWindow } from '@tauri-apps/api/window';

const appWindow = getCurrentWindow();

await appWindow.setTitle('Iskra Desktop');
await appWindow.maximize();
await appWindow.setResizable(false);
```

Reaccionar a eventos de la ventana desde el bus de la App:

```typescript
app.on('window:focus', async (ctx) => {
    ctx.logger.info('La ventana recupero el foco');
});

const appWindow = getCurrentWindow();
await appWindow.onFocusChanged(({ payload: focused }) => {
    app.emit('window:focus', { focused });
});
```

## IPC (comunicacion con el backend Rust)

Tauri expone comandos Rust al frontend mediante `invoke`. Envolve esas llamadas en servicios de tu App para mantener el dominio desacoplado de Tauri.

```typescript
import { invoke } from '@tauri-apps/api/core';

// Llamar a un comando Rust registrado en el backend de Tauri
const usuarios = await invoke<Usuario[]>('listar_usuarios', { activos: true });
```

Registrar el servicio en el contenedor de DI del Core para reutilizarlo:

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

Escuchar eventos emitidos desde Rust y reenviarlos al bus de Iskra:

```typescript
import { listen } from '@tauri-apps/api/event';

await listen<{ progreso: number }>('descarga:progreso', (evento) => {
    app.emit('descarga:progreso', evento.payload);
});
```

## Menus

Los menus nativos se construyen con la API de menu de Tauri. Conecta cada item a un evento de la App para procesarlo con tus handlers.

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

## Configuracion

El `DesktopDriver` no recibe opciones propias: toda la configuracion nativa (tamano de ventana, permisos, iconos) vive en `tauri.conf.json`, el archivo de configuracion de Tauri.

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

El nombre logico de tu App de Iskra se sigue manejando desde el Core:

```typescript
const app = new App({ name: 'Iskra Desktop', logger: { level: 'info' } });
```

## Ejemplo Completo

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

Para una plantilla lista para usar, mira [`templates/desktop-app`](https://github.com/fearful/iskra/tree/main/templates/desktop-app). Si tu app tambien apunta a moviles, revisa [`@iskra-bun/mobile-kit`](/iskra/es/packages/mobile-kit/) y la plantilla [`universal-app`](https://github.com/fearful/iskra/tree/main/templates/universal-app).
