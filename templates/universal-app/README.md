# Universal App

Template para aplicaciones multiplataforma que corren en **escritorio** (Tauri) y **movil** (Tauri mobile) desde un solo codebase. La logica de negocio se escribe una vez y cada plataforma aporta solo su capa de integracion.

## Kits utilizados

- [`@iskra-bun/core`](../../docs/core.md) — Clase App, ciclo de vida, logger
- [`@iskra-bun/desktop-kit`](../../docs/desktop-kit.md) — Driver de escritorio (Tauri)
- [`@iskra-bun/mobile-kit`](../../docs/mobile-kit.md) — Driver movil (Tauri mobile)

## Inicio rapido

```bash
# Desde la raiz del monorepo
bun install

cd templates/universal-app
bun dev
```

Sin un host Tauri, el template corre como proceso server y arranca por defecto en la rama de escritorio. Podes forzar cada rama para probar:

```bash
FORCE_PLATFORM=desktop bun start
FORCE_PLATFORM=mobile  bun start
```

## Como funciona

El flujo es: **detectar plataforma → registrar solo su driver → correr logica compartida**.

1. `src/platform.ts` inspecciona el global del runtime (`__TAURI__`, plataforma del host) y resuelve `desktop`, `mobile` o `server`.
2. `src/main.ts` registra **un solo driver** segun la plataforma activa (no ambos), y conecta su rama.
3. Ambas ramas consumen la misma logica de `src/domain/notes.ts`.

A diferencia de un stub que registra ambos drivers "por las dudas", aca cada entorno activa exclusivamente lo suyo.

## Logica compartida

`src/domain/notes.ts` es una mini libreria de notas, agnostica de plataforma y de UI:

- Valida el input con Zod (`createNote` lanza `ZodError` si el titulo esta vacio).
- Es **inmutable**: `addNote` / `removeNote` devuelven un nuevo array sin mutar el anterior.
- `summarize` produce un resumen apto para loguear o renderizar en cualquier plataforma.

```typescript
import { createNote, addNote, summarize } from './domain/notes.ts';

let notes = [];
notes = addNote(notes, createNote({ title: 'Hola', body: 'Mundo' }));
console.log(summarize(notes)); // { count: 1, titles: ['Hola'] }
```

## Ramas por plataforma

Cada plataforma traduce sus eventos nativos a la logica compartida:

| Plataforma | Archivo | Evento de ejemplo | Que hace |
|------------|---------|-------------------|----------|
| Escritorio | `src/platforms/desktop.ts` | `desktop:new-note` | Crea una nota desde (p. ej.) un menu de Tauri |
| Movil | `src/platforms/mobile.ts` | `mobile:deeplink` | Crea una nota desde un deep link `miapp://note?title=...` |

```typescript
// El driver de cada plataforma se registra solo en su rama
import { DesktopDriver } from '@iskra-bun/desktop-kit';
import { MobileDriver } from '@iskra-bun/mobile-kit';
```

Consulta [docs/mobile-kit.md](../../docs/mobile-kit.md) para el detalle del `MobileDriver` y sus eventos.

## Estructura del proyecto

```
src/
├── main.ts                 # Detecta plataforma y arranca su rama
├── app.config.ts           # Config + FORCE_PLATFORM (Zod)
├── platform.ts             # Deteccion de plataforma en runtime
├── domain/
│   └── notes.ts            # Logica de negocio compartida (inmutable, validada)
└── platforms/
    ├── desktop.ts          # Rama escritorio (DesktopDriver)
    └── mobile.ts           # Rama movil (MobileDriver)
```

## Variables de entorno

| Variable | Descripcion | Default |
|----------|-------------|---------|
| `FORCE_PLATFORM` | `auto`, `desktop` o `mobile` — fuerza la rama sin host Tauri | `auto` |

## Personalizacion

1. Pone tu logica de negocio en `src/domain/` — escribila una vez, sin tocar plataformas.
2. Conecta los eventos nativos de cada plataforma a esa logica en `src/platforms/`.
3. Para empaquetar como app real de escritorio/movil, integra [Tauri](https://tauri.app) sobre estos entry points.

Para entender Drivers y ciclo de vida, revisa la [documentacion de arquitectura](../../docs/arquitectura.md) y el [Core](../../docs/core.md).
