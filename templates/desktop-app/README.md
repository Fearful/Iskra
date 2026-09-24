# Desktop App

App de escritorio con [Tauri](https://tauri.app) e Iskra: **gestion de ventana**, **comandos IPC**,
un **menu nativo**, un **dialogo de archivos** y una **UI** que consume todo eso.

> ⚠️ **Experimental, no funciona de punta a punta todavia.** `src/main.ts` corre como un
> proceso Bun aparte, donde el runtime de Tauri no existe, asi que `bridge.ts` y `menu.ts`
> siempre toman su camino de respaldo (stubs). Ademas `ui/app.js` lee `window.__TAURI__` pero
> `tauri.conf.json` no activa `withGlobalTauri`, y falta `src-tauri/icons/icon.png`, que el
> build de Tauri necesita. `@iskra-bun/desktop-kit` es un placeholder que solo registra el
> ciclo de vida. Tomalo como punto de partida, no como app lista.

## Kits utilizados

- [`@iskra-bun/core`](https://iskra-docs.fly.dev/es/packages/core/) — Clase App, ciclo de vida, logger, bus de eventos
- [`@iskra-bun/desktop-kit`](https://iskra-docs.fly.dev/es/packages/desktop-kit/) — `DesktopDriver`, puente con Tauri

## Arquitectura

La app tiene dos mitades que se comunican por mensajes:

```
┌─────────────────────────┐        invoke / listen        ┌──────────────────────────┐
│  UI (webview)           │  ───────────────────────────► │  Backend Rust (src-tauri) │
│  ui/index.html + app.js │  ◄─────────────────────────── │  comandos: leer_archivo…  │
└─────────────────────────┘                               └──────────────────────────┘
            ▲
            │  (eventos del menu / del SO)
            ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Núcleo Iskra (src/main.ts)                                                   │
│  App + DesktopDriver + DesktopBridge — toda la lógica de dominio vive acá.    │
└─────────────────────────────────────────────────────────────────────────────┘
```

El `DesktopBridge` (`src/bridge.ts`) concentra las llamadas a `@tauri-apps/api`,
asi el dominio no depende directamente de Tauri. Cuando el codigo corre **fuera**
de Tauri (por ejemplo `bun start` en una terminal), el bridge detecta el entorno
y usa stubs que loguean — util para probar la logica sin compilar el binario nativo.

## Inicio rapido

### Solo el núcleo Iskra (sin ventana)

Util para iterar sobre la logica de dominio. No requiere toolchain de Rust.

```bash
# Desde la raiz del monorepo
bun install

cd templates/desktop-app
bun start          # arranca App + DesktopDriver; el bridge usa stubs
```

### App de escritorio completa (con ventana Tauri)

Requiere el [toolchain de Rust](https://www.rust-lang.org/tools/install) y las
[dependencias de sistema de Tauri](https://tauri.app/start/prerequisites/).

```bash
cd templates/desktop-app
bun install
bun run tauri:dev      # compila el backend Rust y abre la ventana
# para empaquetar instaladores:
bun run tauri:build
```

## Funcionalidades

### Gestion de ventana

`src/main.ts` setea el titulo al arrancar via `bridge.setWindowTitle()`. La UI
tambien cambia el titulo y minimiza la ventana con la API de window de Tauri
(`getCurrentWindow().setTitle()` / `.minimize()`). El tamano inicial, minimos y
centrado se configuran en `src-tauri/tauri.conf.json`.

### Comandos IPC

El backend Rust (`src-tauri/src/lib.rs`) expone dos comandos:

- `leer_archivo({ ruta })` → devuelve el contenido de un archivo de texto
- `app_info()` → devuelve `{ name, version }`

Se invocan desde la UI con `invoke()` y desde el dominio con `bridge.invoke()`.
Agregar un comando nuevo: definí la funcion con `#[tauri::command]` y sumala a
`tauri::generate_handler![...]`.

### Menu nativo

`src/menu.ts` construye un menu (Archivo → Abrir/Salir, Ayuda → Acerca de). Cada
item, al activarse, **emite un evento en el bus de Iskra** (`menu:abrir-archivo`,
`menu:acerca-de`) en lugar de ejecutar logica inline. Los handlers viven en
`registerHandlers()` de `main.ts`, junto al resto del dominio.

### Dialogo de archivos

El handler de `menu:abrir-archivo` llama a `bridge.openFileDialog()` (plugin
`@tauri-apps/plugin-dialog`), lee el archivo elegido via el comando Rust
`leer_archivo` y emite `archivo:cargado`. La UI tiene el mismo flujo con su boton
"Abrir archivo…".

### UI

`ui/` es un frontend estatico (HTML + CSS + JS, sin framework) que Tauri sirve
como `frontendDist`. Funciona tambien en un navegador comun: si `window.__TAURI__`
no existe, los botones muestran un aviso en vez de fallar.

## Estructura del proyecto

```
src/
├── main.ts              # Núcleo Iskra: App + DesktopDriver + handlers de dominio
├── app.config.ts        # Configuracion con Zod (nombre, versión)
├── bridge.ts            # DesktopBridge: window / invoke / dialog / eventos
└── menu.ts              # Menu nativo cableado al bus de eventos
ui/
├── index.html           # Interfaz
├── styles.css           # Estilos
└── app.js               # Lógica de UI (invoke, dialog, window)
src-tauri/
├── tauri.conf.json      # Config de la ventana, CSP, plugins, bundle
├── Cargo.toml           # Dependencias Rust
├── build.rs             # Hook de build de Tauri
├── capabilities/        # Permisos (window, dialog) de la ventana "main"
└── src/
    ├── lib.rs           # Comandos IPC (leer_archivo, app_info)
    └── main.rs          # Entry point del binario
```

## Mapa de eventos

| Evento | Origen | Handler |
| :--- | :--- | :--- |
| `menu:abrir-archivo` | Item de menu | Abre diálogo, lee archivo, emite `archivo:cargado` |
| `menu:acerca-de` | Item de menu | Loguea info y cambia el título |
| `archivo:cargado` | `bridge` | Deja el contenido listo para la UI |
| `window:focus` | SO (`tauri://focus`) | Loguea el cambio de foco |

## Personalizacion

1. Agregá comandos Rust en `src-tauri/src/lib.rs` y sus permisos en `capabilities/`.
2. Cableá nuevas acciones de menu en `src/menu.ts` + un handler en `main.ts`.
3. Ajustá la ventana (tamano, decoraciones, multiples ventanas) en `tauri.conf.json`.
4. Reemplazá `ui/` por tu framework favorito apuntando `frontendDist` a su build.

Referencia de la API del kit: [@iskra-bun/desktop-kit](https://iskra-docs.fly.dev/es/packages/desktop-kit/).
Para apps que tambien apuntan a moviles, mirá [`universal-app`](../universal-app/).
