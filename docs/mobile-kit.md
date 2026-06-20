# @iskra-bun/mobile-kit

> ⚠️ **Alpha (no funcional aún).** El `MobileDriver` actual solo registra el ciclo de vida; los puentes reales de los plugins móviles de Tauri v2 (deep links, notificaciones, orientación/barra de estado) llegan en **v0.2**. Los ejemplos describen la API planificada y todavía no son utilizables.

Driver para ejecutar una App de Iskra en plataformas moviles (iOS / Android) sobre el bridge de [Tauri](https://tauri.app). Comparte el mismo modelo de ciclo de vida que el resto de los Drivers del framework.

## Instalacion

El paquete ya forma parte del monorepo. Para usarlo en un template o app, declaralo como dependencia de workspace:

```json
{
    "dependencies": {
        "@iskra-bun/core": "workspace:*",
        "@iskra-bun/mobile-kit": "workspace:*",
        "@tauri-apps/api": "^2.0.0"
    }
}
```

```bash
bun install
```

## Inicio Rapido

`MobileDriver` implementa la interfaz `Driver` del Core. Se registra en la App y participa del ciclo de vida `init → start → stop`:

```typescript
import { App } from '@iskra-bun/core';
import { MobileDriver } from '@iskra-bun/mobile-kit';

const app = new App({ name: 'MiAppMovil' });

app.register(new MobileDriver());

await app.start();
// → "Initializing Mobile Driver..."
// → "Mobile Driver started."
```

Al llamar `app.stop()` el driver libera sus recursos:

```typescript
await app.stop();
// → "Mobile Driver stopped."
```

## La clase MobileDriver

El driver expone tres metodos del ciclo de vida. No requiere configuracion adicional para arrancar:

```typescript
import type { Driver, App } from '@iskra-bun/core';

export class MobileDriver implements Driver {
    name = 'MobileDriver';

    async init(app: App) { /* guarda referencia a la App */ }
    async start() { /* registra listeners moviles: deep links, push, etc. */ }
    async stop() { /* limpieza */ }
}
```

| Metodo | Cuando se ejecuta | Proposito |
| --- | --- | --- |
| `init(app)` | En `app.init()` / `app.start()` | Recibe la App y guarda la referencia |
| `start()` | En `app.start()`, tras `init` | Punto donde se enganchan eventos nativos |
| `stop()` | En `app.stop()` | Cierra listeners y libera recursos |

## Deteccion de Plataforma

Un mismo codebase puede registrar el `MobileDriver` solo cuando corre en un entorno movil de Tauri. Detecta el entorno antes de registrar:

```typescript
import { App } from '@iskra-bun/core';
import { MobileDriver } from '@iskra-bun/mobile-kit';

const app = new App({ name: 'MiApp' });

const isTauri = typeof window !== 'undefined' && '__TAURI__' in window;

if (isTauri) {
    app.register(new MobileDriver());
}

await app.start();
```

Para una app universal (escritorio + movil) se registran ambos drivers y cada uno actua segun su entorno:

```typescript
import { App } from '@iskra-bun/core';
import { DesktopDriver } from '@iskra-bun/desktop-kit';
import { MobileDriver } from '@iskra-bun/mobile-kit';

const app = new App({ name: 'Universal' });

app.register(new DesktopDriver());
app.register(new MobileDriver());

await app.start();
```

## Eventos Moviles

El `start()` del driver es el lugar donde se enganchan los eventos nativos (deep links, push notifications) al bus de la App. Tu logica de negocio los escucha con `app.on(...)`:

```typescript
// Emitido desde el bridge nativo (Tauri) hacia el bus de la App
app.on('mobile:deeplink', async (ctx) => {
    app.logger.info({ url: ctx.payload.url }, 'Deep link recibido');
});

app.on('mobile:push', async (ctx) => {
    app.logger.info({ notification: ctx.payload }, 'Push recibido');
});
```

Cada handler recibe un `Context` con `app`, `logger`, `payload` y `reply`, igual que el resto del framework.

## Integracion con Tauri

`mobile-kit` depende de `@tauri-apps/api`. Desde el `start()` del driver se invocan comandos nativos definidos en la capa Rust de Tauri:

```typescript
import { invoke } from '@tauri-apps/api/core';

// Dentro de un metodo del driver o de un handler de evento
const battery = await invoke<number>('get_battery_level');
app.logger.info({ battery }, 'Nivel de bateria');
```

## Ejemplo Completo

```typescript
// src/main.ts
import { App } from '@iskra-bun/core';
import { MobileDriver } from '@iskra-bun/mobile-kit';

const app = new App({ name: 'NotasMovil' });

app.register(new MobileDriver());

app.on('mobile:deeplink', async (ctx) => {
    app.logger.info({ url: ctx.payload.url }, 'Abriendo desde deep link');
});

async function main() {
    await app.start();
    app.logger.info('App movil lista');
}

main().catch((err) => app.logger.error({ err }, 'Fallo al arrancar'));
```

Para un proyecto multiplataforma listo para usar, revisa el template [`universal-app`](../templates/universal-app/README.md). Para el ciclo de vida de los Drivers, consulta la [documentacion de arquitectura](./arquitectura.md) y el [Core](./core.md).
