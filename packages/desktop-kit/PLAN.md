# Plan: apps de escritorio y mobile (desktop-kit, mobile-kit y native-kit)

> **Estado:** propuesta para revisar · **Fecha:** 2026-09-25
>
> Sale de leer el repo y de las decisiones tomadas con el mantenedor (ver
> [§1](#1-decisiones-tomadas)). Nada de esto está implementado todavía.

## Resumen

- **Tauri v2** como host en Windows, macOS, Linux, iOS y Android: un solo
  adaptador cubre las cinco plataformas.
- La **App de Iskra corre en el webview**, con el mismo código en desktop y
  mobile. Para eso el core suma un entry para navegador.
- Un paquete nuevo, **`@iskra-bun/native-kit`**, trae los puertos, la matriz de
  capacidades, los hosts (Tauri y memoria) y los módulos compartidos.
  `desktop-kit` y `mobile-kit` quedan finos: solo sus módulos exclusivos.
- Cada módulo declara su nivel por plataforma: **total**, **parcial** (misma
  API; lo que falta se detecta con `supports()`) o **exclusivo**.
- **M1**: base, sistema compartido, datos y backend, exclusivos de desktop y
  exclusivos de mobile, validados a mano en las cinco plataformas.
- **M2**: backend Iskra local en desktop. Arranca comparando **Tauri + sidecar
  Bun** contra **Electrobun** (runtime Bun), y se implementa el que gane.

## 1. Decisiones tomadas

| Tema | Decisión | Por qué |
| :-- | :-- | :-- |
| Host nativo | Tauri v2 en las 5 plataformas | Un adaptador sirve a desktop y a mobile; es lo que ya asumen los templates y la doc |
| Dónde corre la App | En el webview; backend local opcional en desktop | Mismo código en las dos plataformas; en iOS no hay Bun |
| Paquetes | `native-kit` nuevo + `desktop-kit` y `mobile-kit` finos | El código común no queda con nombre de "desktop" |
| Alcance del M1 | Base, sistema compartido, datos y backend, exclusivos desktop, exclusivos mobile | Prioridad del mantenedor |
| Backend local en desktop | M2, empezando por comparar sidecar Bun contra Electrobun | El sidecar es la pieza más riesgosa; Electrobun la evita, pero es solo desktop y su v2 todavía se está estabilizando |
| UI de los templates | TypeScript + Vite, sin framework | Neutral, y se porta fácil a cualquier framework |
| QA manual | Linux, Windows, macOS, Android, iOS | Son las plataformas disponibles para probar |
| CI | Tests en Bun + un job de `cargo check` para los templates | Los módulos se prueban sin Rust; el lado nativo compila en CI |

Descartado: la App viviendo en un proceso Bun (no deja camino a mobile), y
Capacitor o React Native en mobile (dos hosts desde el día uno, y con React
Native además la UI no se comparte).

## 2. Estado actual

- `desktop-kit` y `mobile-kit` son placeholders: un `Driver` que solo loguea un
  warning al arrancar ([`src/driver.ts`](./src/driver.ts)). Las páginas del sitio
  describen una API planificada que no existe.
- El template [`desktop-app`](../../templates/desktop-app/) no puede funcionar
  tal como está. `src/main.ts` corre como un proceso Bun aparte, pero
  `@tauri-apps/api` solo existe dentro del webview, así que `bridge.ts` y
  `menu.ts` siempre caen a sus stubs. Además, `ui/app.js` lee
  `window.__TAURI__` sin que `withGlobalTauri` esté activado, y falta
  `src-tauri/icons/icon.png`.
- El template [`universal-app`](../../templates/universal-app/) no tiene
  proyecto Tauri, y la detección de mobile depende de `tauri-plugin-os`, que no
  está instalado.
- El core no corre en un webview: importa `pino-pretty` y `c12`, que son de
  Node, y usa `process.on`, `process.exit` y `process.env`
  ([`app.ts`](../core/src/app.ts), [`logger`](../core/src/logger/index.ts),
  [`config/loader.ts`](../core/src/config/loader.ts)).
- Los kits de servidor dependen de APIs de Bun o de Node (`bun:sqlite`,
  `Bun.serve`, `Bun.file`, `Bun.spawn`, `ioredis`). En desktop pueden correr en
  un proceso aparte; en iOS no hay Bun.
- `KVManager` importa `ioredis` de forma estática, así que `kv-kit` hoy no se
  puede usar en un navegador, ni siquiera con el adaptador en memoria.
- auth-kit usa sesiones por cookie. Desde el webview (origen `tauri://localhost`
  o `http://tauri.localhost`) las cookies hacia un backend remoto son frágiles,
  sobre todo en iOS.
- No hay cliente TypeScript para un backend Iskra: solo existen los SDKs de Java
  y Python, aunque el [ROADMAP](../../ROADMAP.md) menciona uno en TypeScript.

## 3. Arquitectura

### 3.1 Capas

```
┌──────────────── Webview: el mismo código en desktop y mobile ────────────────┐
│ UI (TypeScript + Vite)                                                       │
│ App de Iskra (core con entry de navegador) + tu dominio                      │
│ NativeDriver → módulos: dialog · store · sql · backend · menu · haptics …    │
│ Cada módulo trae su implementación por host:                                 │
│   Tauri │ memoria (tests, headless) │ M2: ¿Electrobun?                       │
└────────────┬─────────────────────────────────────────────┬───────────────────┘
             │ IPC: invoke y eventos                       │ HTTP / WebSocket
┌────────────▼──────────────────────┐   ┌──────────────────▼───────────────────┐
│ Tauri v2 (Rust)                   │   │ Backend Iskra                        │
│ plugins oficiales + comandos      │   │ web-kit · auth-kit · db-kit · …      │
│ propios de la app                 │   │ desktop: local (M2) · mobile: remoto │
└───────────────────────────────────┘   └──────────────────────────────────────┘
```

- **Módulo**: lo que usa la app. Maneja su ciclo de vida, publica eventos en el
  bus, valida el soporte y tira errores tipados.
- **Implementación por host**: el código que habla con la plataforma concreta
  (`tauri`, `memory`). Vive en archivos separados de la lógica del módulo y se
  carga con `import()` diferido, así el bundle solo lleva lo que la app usa.
- **Host**: detecta la plataforma y elige la implementación de cada módulo.
  `TauriHost` en el M1; `MemoryHost` para tests y para correr sin ventana; en el
  M2, quizás `ElectrobunHost`.

Sumar un host nuevo significa agregar una implementación por módulo, sin tocar
su lógica. La comparación del M2 pone a prueba justamente esta separación.

### 3.2 Uso

```ts
// src/main.ts: corre en el webview, el mismo archivo en desktop y mobile
import { App } from '@iskra-bun/core';
import { NativeDriver, dialog, notification, store, sql, deepLink } from '@iskra-bun/native-kit';
import { tauriHost } from '@iskra-bun/native-kit/tauri';
import { menu, tray } from '@iskra-bun/desktop-kit';
import { haptics } from '@iskra-bun/mobile-kit';
import { migrations } from './db/migrations';

const app = new App({ name: 'Notas' });

app.register(
    new NativeDriver({
        host: tauriHost(),
        modules: [
            dialog(),
            notification(),
            store({ path: 'settings.json' }),
            sql({ url: 'sqlite:notas.db', migrations }),
            deepLink(),
            // Los exclusivos se registran igual: donde no hay soporte quedan inactivos.
            menu({ items: [{ id: 'nueva', text: 'Nueva nota', accelerator: 'CmdOrCtrl+N', emit: 'notas:nueva' }] }),
            tray({ tooltip: 'Notas' }),
            haptics(),
        ],
    }),
);

await app.start();

const native = app.context.get('native'); // NativeDriver, tipado
native.platform; // { os: 'android', formFactor: 'mobile', host: 'tauri', ... }

const ruta = await native.get('dialog').open({ filters: [{ name: 'Texto', extensions: ['txt'] }] });
if (native.supports('haptics')) await native.get('haptics').impact('light');

app.on('native:deep-link', (ctx) => ctx.logger.info({ urls: ctx.payload.urls }, 'Deep link'));
```

`DesktopDriver` y `MobileDriver` pasan a ser presets de `NativeDriver`: usan
Tauri como host por defecto y avisan si corren en el form factor que no les
corresponde. Una app universal usa `NativeDriver` directo. Esto rompe la API
actual, que es trivial; en paquetes experimentales está permitido
([VERSIONING](../../VERSIONING.md)).

### 3.3 Contratos

```ts
export type FormFactor = 'desktop' | 'mobile';
export type SupportLevel = 'full' | 'partial' | 'none';

export interface NativeModule<Api = unknown> {
    name: string;
    /** Soporte por form factor; `features` baja al detalle (p. ej. `dialog.pickDirectory`). */
    support: Record<FormFactor, SupportLevel> & {
        features?: Record<string, Partial<Record<FormFactor, SupportLevel>>>;
    };
    /** Lo que necesita del lado nativo. Lo usan `iskra-native doctor`/`add` y los errores. */
    requires?: { tauriPlugin?: string; cargoFeatures?: string[]; permissions?: string[] };
    /** Implementación por host, cargada solo si el host activo la usa. */
    impl: { tauri?: () => Promise<unknown>; memory: () => Promise<unknown> };
    dependencies?: string[];
    setup(ctx: ModuleContext): Promise<Api> | Api;
    stop?(): Promise<void> | void;
}

// native.get(name) queda tipado, como FeatureRegistry en web-kit:
declare module '@iskra-bun/native-kit' {
    interface NativeModuleRegistry {
        dialog: DialogApi;
    }
}
```

- **Eventos** (declarados en `AppEvents`): `native:ready`, `native:foreground`,
  `native:background`, `native:focus`, `native:blur`, `native:close-requested`,
  `native:deep-link`, `native:second-instance` y `native:notification-action`.
  Los ítems de menú, tray y atajos emiten eventos que declara la app
  (`emit: 'notas:nueva'`).
- **Errores**: `NativeError` extiende `IskraError`, con tres subclases:
  - `UnsupportedCapabilityError`;
  - `PluginMissingError`, cuyo mensaje dice qué correr (p. ej.
    `bunx tauri add dialog`);
  - `PermissionDeniedError`.

  Los códigos nuevos (`NATIVE_UNSUPPORTED`, `NATIVE_PLUGIN_MISSING`,
  `NATIVE_PERMISSION_DENIED`, `NATIVE_HOST_UNAVAILABLE`) se suman a `ErrorCodes`
  del core, como los de los otros kits.
- **DI**: el driver queda en `app.context.get('native')`.
- **Dependencias**: `@tauri-apps/api` y los plugins son peer dependencies
  opcionales, porque una app en otro host no los necesita. Los instala la app,
  y `iskra-native add` lo hace por ella.

### 3.4 Niveles de compatibilidad

- **Total**: misma API y mismo comportamiento en desktop y mobile.
- **Parcial**: misma API, pero alguna función u opción no existe en una
  plataforma. `supports('dialog.pickDirectory')` lo dice antes de llamar. Si se
  llama igual, tira `UnsupportedCapabilityError` con el módulo, la función y la
  plataforma en `context`.
- **Exclusivo**: solo existe en desktop o solo en mobile. Se puede registrar en
  una app universal; en la otra plataforma, `supports()` devuelve `false`.

La matriz vive en la metadata de cada módulo. La tabla de la doc se genera desde
ahí, y un test falla si se desincronizan.

### 3.5 Requisitos nativos: `iskra-native doctor` y `add`

Cada módulo que usa un plugin de Tauri necesita tres cosas además del código
TypeScript: el paquete npm, el crate registrado en `lib.rs` y los permisos en
`capabilities/*.json`. Si falta una, el resultado es un error de IPC poco claro.
Para evitarlo:

- **`iskra-native doctor`** lee la lista de módulos de la app (por convención,
  `src/native.ts` exporta `modules`). Después cruza sus `requires` con
  `package.json`, `src-tauri/Cargo.toml`, `lib.rs` y las capabilities. Corre
  local y en CI.
- **`iskra-native add <módulo>`** envuelve `tauri add <plugin>` y suma las
  features de Cargo y los permisos que falten.
- En runtime, si falta un plugin, `TauriHost` tira `PluginMissingError` con el
  comando que lo arregla.

### 3.6 Multiventana (desktop)

Cada ventana de Tauri es un contexto JS aparte, así que cada una corre su propia
App:
- el estado compartido vive en `store`, en `sql` o en el backend;
- los eventos que tienen que llegar a todas las ventanas se marcan como
  globales, y `bridge` los reenvía con los eventos de Tauri.

En mobile hay una sola ventana y esto no cambia nada. La alternativa es que la
ventana principal sea dueña del dominio y las demás sean vistas; se evalúa en F4
con un ejemplo de dos ventanas.

### 3.7 El core en el navegador

- El `package.json` del core suma un `imports` con condición `browser`
  (`#runtime`). En el navegador, eso cambia cuatro cosas:
  - el logger usa el build de navegador de pino, sin `pino-pretty`;
  - no hay `c12`: la config se pasa explícita al `App`;
  - no hay OTel;
  - no hay señales de proceso.
- tsup genera un segundo entry (`dist/index.browser.js`, con
  `platform: 'browser'`), y el mapa `exports` lo expone con la condición
  `browser`. Dentro del monorepo, Vite resuelve `source` + `browser` y usa
  `src/` directo.
- Test: buildea el core con `Bun.build({ target: 'browser' })` y falla si entra
  `node:*`, `c12` o `pino-pretty`.
- En Bun y en Node no cambia nada. Es un cambio aditivo en un paquete estable:
  va como minor.

### 3.8 Seguridad

- CSP estricta en `tauri.conf.json`. No se usa `withGlobalTauri`: los templates
  importan `@tauri-apps/api` a través de Vite.
- Capabilities mínimas por ventana: `fs` limitado a los directorios de la app y
  `http` limitado a las URLs del backend configurado.
- Los tokens quedan detrás de un puerto `SecretStore` (ver
  [riesgos](#8-riesgos-y-preguntas-abiertas)).
- Si el sidecar gana en el M2: escucha en `127.0.0.1` con puerto aleatorio,
  token efímero y chequeo de `Origin`.

## 4. Matriz de módulos del M1

✅ total · ◐ parcial · — no disponible

| Módulo | Paquete | Plugin o API de Tauri | Desktop | Mobile | Notas |
| :-- | :-- | :-- | :-: | :-: | :-- |
| `platform` | native-kit | `plugin-os`, `api/app` | ✅ | ✅ | SO, arquitectura, locale, form factor, nombre y versión de la app |
| `lifecycle` | native-kit | ventana + `visibilitychange` | ◐ | ◐ | Misma API: desktop emite foco y cierre; mobile, pausa y reanudación |
| `bridge` | native-kit | core (`invoke`, eventos) | ✅ | ✅ | `invoke` tipado a comandos Rust, reenvío de eventos al bus, eventos entre ventanas |
| `dialog` | native-kit | `plugin-dialog` | ✅ | ◐ | Mobile: no elige carpetas; `save` a verificar |
| `notification` | native-kit | `plugin-notification` | ✅ | ✅ | Acciones y canales solo en mobile (parcial por función) |
| `clipboard` | native-kit | `plugin-clipboard-manager` | ✅ | ◐ | Texto en todas; imagen y HTML a verificar en mobile |
| `opener` | native-kit | `plugin-opener` | ✅ | ◐ | `revealItemInDir` y abrir rutas locales: solo desktop |
| `deepLink` | native-kit | `plugin-deep-link` | ✅ | ✅ | Registrar esquemas en runtime solo en Windows y Linux; en el resto, por config |
| `store` | native-kit | `plugin-store` | ✅ | ✅ | Implementa `KVAdapter` de kv-kit |
| `fs` | native-kit | `plugin-fs` | ✅ | ◐ | Sin garantía oficial en mobile: limitado a los directorios de la app |
| `sql` | native-kit | `plugin-sql` (SQLite) | ✅ | ✅ | Drizzle `sqlite-proxy` + migraciones; transacciones a validar |
| `backend` | native-kit + `client` | `plugin-http` (opcional) | ✅ | ✅ | HTTP, sesión bearer y WebSocket (protocolo de socket-kit) |
| `window` | desktop-kit | ventana + `plugin-window-state` | ✅ | — | Título, tamaño, multiventana, restaurar estado |
| `menu` | desktop-kit | `api/menu` | ✅ | — | Menú de la app y contextual; cada ítem emite un evento del bus |
| `tray` | desktop-kit | `api/tray` (feature `tray-icon`) | ✅ | — | |
| `shortcuts` | desktop-kit | `plugin-global-shortcut` | ✅ | — | |
| `autostart` | desktop-kit | `plugin-autostart` | ✅ | — | |
| `singleInstance` | desktop-kit | `plugin-single-instance` | ✅ | — | Solo tiene API en Rust: el template trae el código que reenvía a JS |
| `updater` | desktop-kit | `plugin-updater` + `plugin-process` | ✅ | — | Requiere claves de firma y hosting; en mobile se actualiza por la tienda |
| `haptics` | mobile-kit | `plugin-haptics` | — | ✅ | |
| `biometric` | mobile-kit | `plugin-biometric` | — | ✅ | |
| `barcode` | mobile-kit | `plugin-barcode-scanner` | — | ✅ | |
| `geolocation` | mobile-kit | `plugin-geolocation` | — | ✅ | |
| `safeArea` | mobile-kit | CSS `env(safe-area-inset-*)` | — | ◐ | Los insets sí; el estilo de la barra de estado no tiene plugin oficial |

Las celdas de mobile se confirman en F3 con QA en dispositivo. La tabla de
plataformas de Tauri marca `fs`, `websocket` y `stronghold` como "sin probar" en
mobile ([plugins-workspace](https://github.com/tauri-apps/plugins-workspace)).

## 5. Fases

Tamaños relativos: S, M, L. Los módulos de F1 y F2 son PRs independientes entre
sí. F3 y F4 pueden ir en paralelo si trabajan dos personas.

### Milestone 1: módulos en el webview sobre Tauri v2

**F0. Fundaciones (L)**

1. **core**: entry de navegador (§3.7) y códigos de error nativos. Changeset
   minor.
2. **native-kit, esqueleto**:
   - `NativeDriver`, el contrato `NativeModule` y `NativeModuleRegistry`;
   - detección de plataforma, niveles de soporte y `supports()`, errores;
   - `MemoryHost` y `TauriHost`, este último con carga diferida y
     `PluginMissingError`.
   - Exports: `.` y `./tauri`. Marcado como experimental.
3. **Módulos base**: `platform`, `lifecycle` y `bridge`.
4. **CLI `iskra-native`**: `doctor` y `add` (§3.5).
5. **Reescritura de `desktop-app`**:
   - Vite + TS sin framework, y la App corre en el webview;
   - se va el `bridge.ts` escrito a mano;
   - íconos generados con `tauri icon` y capabilities mínimas;
   - un boot test headless con `MemoryHost`.
6. **CI, `native.yml`**: Rust y las dependencias de WebKitGTK en Ubuntu.
   `vite build`, `cargo check` e `iskra-native doctor` para cada template.
   Corre solo cuando cambian los paquetes nativos o los templates.

Salida: el template abre en Linux, Windows y macOS con la App en el webview, y el
bus recibe los eventos de la ventana. `bun run ci` y `native.yml` dan verde.

**F1. Sistema compartido (M)**

- Un PR por módulo: `dialog`, `notification`, `clipboard`, `opener` y
  `deepLink`. Cada PR incluye:
  - el módulo, con su implementación Tauri y su implementación en memoria;
  - tests de contrato (§6);
  - los `requires` para `doctor`;
  - docs EN y ES;
  - sus filas en el checklist de QA.
- `desktop-app` los usa: abrir un archivo, notificar, copiar, abrir una URL y
  recibir un deep link `iskra-desktop://`.

Salida: QA en Linux, Windows y macOS.

**F2. Datos y backend (L)**

- `store`: implementa `KVAdapter`. kv-kit pasa a cargar `ioredis` en forma
  diferida, para que `KVManager` y cache-kit se puedan usar en el webview.
- `fs`: directorios de la app, con scopes mínimos.
- `sql`: arranca con un spike corto de transacciones sobre `plugin-sql`. Usa
  Drizzle `sqlite-proxy` con su migrador. Incluye una guía para compartir
  esquemas con db-kit cuando el servidor también usa SQLite.
- **`@iskra-bun/client`** (paquete nuevo, experimental): cliente TypeScript para
  web-kit, auth-kit y socket-kit.
  - Es el espejo de los SDKs de Java y Python: auth, health, storage y errores
    tipados.
  - Recibe un `fetch` inyectable y corre en navegador, Bun y Node.
  - Se prueba contra [`sdks/contract/server.ts`](../../sdks/contract/server.ts).
- **Módulo `backend`**: envuelve el client.
  - Transporte por `plugin-http`, que evita CORS.
  - La sesión persiste detrás de `SecretStore`.
  - El WebSocket se reconecta cuando `lifecycle` avisa que la app volvió.
- **Servidor**:
  - auth-kit y web-kit suman un modo bearer (plugin `bearer` de better-auth) y
    aceptan los orígenes de Tauri en `trustedOrigins` y CORS;
  - socket-kit suma una guía de autenticación por ticket.

Salida: el template guarda notas en SQLite y preferencias en `store`, y se loguea
contra el contract server.

**F3. Mobile (L)**

- `universal-app` reescrito: el mismo `src/` que en desktop, con proyectos
  Android e iOS (`tauri android init`, `tauri ios init`). Se decide qué parte de
  `src-tauri/gen/` se commitea.
- Validar F1 y F2 en Android y en iOS, y corregir la matriz con lo que de verdad
  pase: acá se resuelven las celdas "a verificar".
- `lifecycle` en mobile: pausa y reanudación. El módulo `backend` se reconecta al
  volver.
- mobile-kit: `haptics`, `biometric`, `barcode`, `geolocation` y `safeArea`.
  `MobileDriver` pasa a ser un preset de `NativeDriver`.

Salida: universal-app corre en emulador y en dispositivo Android, y en simulador
y en dispositivo iOS, con el QA completo.

**F4. Exclusivos de desktop (M)**

- desktop-kit:
  - `window` (+ `windowState`), `menu`, `tray`, `shortcuts` y `autostart`;
  - `singleInstance`, que también reenvía los deep links a la instancia abierta;
  - `updater`, con una guía de firma y `latest.json` en GitHub Releases.
- `DesktopDriver` pasa a ser un preset de `NativeDriver`.
- Se valida el modelo multiventana (§3.6) con un ejemplo de dos ventanas.

Salida: QA en Linux, Windows y macOS, incluido un ciclo de update firmado.

**F5. Cierre del M1 (S)**

- Docs EN y ES:
  - páginas nuevas de `native-kit` y `client`;
  - `desktop-kit` y `mobile-kit` reescritas, sin el aviso de placeholder;
  - una guía "Apps de escritorio y mobile";
  - `templates.md`, `index.mdx` y `api.md`, más `website/typedoc.json` y el
    sidebar de Astro;
  - las tablas de `README.md` y `README.es.md`.
- La matriz de la doc se genera desde la metadata de los módulos, con su test de
  sincronía.
- VERSIONING (`native-kit` y `client` como experimentales), ROADMAP (incluida la
  corrección sobre el cliente TypeScript) y changesets.

### Milestone 2: backend Iskra local en desktop

**F6. Comparación (time-box de 2 semanas)**

El mismo ejemplo en dos prototipos: web-kit + auth-kit + db-kit (SQLite),
consumido por el módulo `backend`.

- **A. Tauri + sidecar Bun**:
  - binario hecho con `bun build --compile` por target triple (`externalBin`) y
    lanzado con `plugin-shell`;
  - handshake por stdout con el puerto y un token efímero;
  - escucha en `127.0.0.1`, con API key de web-kit y chequeo de `Origin`;
  - el sidecar se apaga cuando se cierra su stdin.
- **B. Electrobun con runtime Bun**:
  - el backend corre en el proceso principal;
  - `ElectrobunHost` implementa los módulos de F1 y F4 sobre su RPC tipado;
  - las requests del RPC van directo a `kernel.getApp().fetch()` de web-kit, sin
    puerto;
  - probar también con Cottontail, el runtime por defecto de la v2, para medir
    si los kits andan ahí.
- **Criterios**: que los kits anden sin cambios, tamaño del instalador, arranque
  en frío, memoria, complejidad (código y config), firma y updater, plataformas
  mínimas y riesgo de mantenimiento.

Salida: un documento de decisión con los números.

**F7. Implementación de la opción elegida**, con su template y su doc.

### Backlog (sin milestone)

- `WebHost`, para correr la UI en un navegador común (en dev y como PWA).
- Notificaciones push (FCM y APNs): no hay plugin oficial.
- `SecretStore` nativo (Keychain, Keystore, DPAPI), si en F2 y F3 no aparece
  algo sólido.
- NFC, share sheet y estilo de la barra de estado.
- create-iskra con los templates nativos.
- Sidecar en Android: Bun tiene builds para Android desde
  [1.3.14](https://bun.com/blog/bun-v1.3.14). En iOS no es posible.
- Un crate propio, `tauri-plugin-iskra`, si `doctor` y `add` no alcanzan.

## 6. Pruebas

- **Tests de contrato**:
  - cada módulo tiene una suite que corre contra `MemoryHost` y contra
    `TauriHost` con los mocks oficiales (`@tauri-apps/api/mocks`: `mockIPC`,
    `mockWindows`);
  - verifica que los dos hosts se comporten igual, y que el de Tauri mande los
    comandos y argumentos correctos a cada plugin;
  - no necesita Rust: corre en el job de CI actual.
- **Core en el navegador**: el test de bundle de §3.7.
- **Cliente**: `@iskra-bun/client` contra el contract server, como los SDKs de
  Java y Python.
- **Templates**: el boot test headless con `MemoryHost` (como hoy), más
  `native.yml` con `vite build`, `cargo check` e `iskra-native doctor`.
- **QA manual**: cada PR de módulo suma sus filas a un checklist por plataforma.
  - Orden: Linux → Windows → macOS → Android → iOS.
  - Una celda de la matriz solo pasa de "a verificar" a ✅ o ◐ con el QA hecho.

## 7. Docs y versionado

- Las páginas EN y ES van en el mismo PR que el código, como pide
  [CONTRIBUTING](../../CONTRIBUTING.md).
- `native-kit` y `client` entran como experimentales (VERSIONING y keyword
  `experimental`).
- Changesets:
  - core minor (entry de navegador y códigos de error);
  - desktop-kit y mobile-kit minor, con cambios que rompen (permitido en
    experimentales);
  - auth-kit y web-kit minor (modo bearer);
  - kv-kit patch (`ioredis` diferido).

## 8. Riesgos y preguntas abiertas

1. **Transacciones en `plugin-sql`**, que usa un pool de sqlx. F2 empieza con un
   spike. Si no andan, el plan B es un batch en un solo `execute` o un comando
   Rust propio.
2. **Guardado seguro de tokens**. No hay plugin oficial que cubra Keychain y
   Keystore en las cinco plataformas: `stronghold` figura sin probar en mobile.
   El M1 usa `store` detrás de `SecretStore`, con un aviso explícito, y la
   implementación segura se decide en F2 y F3.
3. **Auth desde el webview**. Las cookies cross-origin son frágiles, por eso el
   modo bearer. El WebSocket del navegador no manda headers: se usa un ticket de
   un solo uso y vida corta, y nunca el token de sesión en la URL.
4. **Deep links**. Los App Links de Android y los Universal Links de iOS
   necesitan publicar `assetlinks.json` y `apple-app-site-association` en el
   dominio.
5. **Updater**. Requiere claves de firma y hosting para `latest.json`. En mobile,
   las actualizaciones van por las tiendas.
6. **Proyectos mobile**: qué parte de `src-tauri/gen/` se commitea en
   `universal-app`. Se decide en F3.
7. **Electrobun**. Su v2 todavía se está estabilizando, y Bun quedó como runtime
   secundario ([blog de Electrobun 2.0](https://blackboard.sh/blog/electrobun-2-0/)).
   Se evalúa en el M2 sin comprometer el M1.
8. **Íconos**. `tauri icon` genera binarios que van al repo; son chicos, pero
   binarios.

## 9. Próximo paso

Si el plan cierra, arrancar por F0.1 (el entry de navegador del core): es chico,
es aditivo y destraba todo lo demás.
