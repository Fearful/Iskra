---
title: create-iskra
description: CLI de scaffolding de proyectos para Iskra.
---

CLI de scaffolding para Iskra. Crea un proyecto nuevo desde una plantilla oficial con un solo comando.

## Inicio Rapido

```bash
bun create iskra my-app
```

El comando solicita un directorio y una plantilla si no los pasas, copia la plantilla elegida y deja el proyecto listo para `bun install`.

Modo no interactivo:

```bash
bun create iskra my-app --template simple-server --yes
```

También funciona con npm:

```bash
npm create iskra@latest my-app
```

## Qué hace

1. Copia la plantilla elegida en `my-app/`, excluyendo `node_modules`, `dist` y `.git`.
2. Reescribe `package.json`: establece `name` con el nombre base del directorio destino y reemplaza cada dependencia `@iskra-bun/* : workspace:*` por un rango semver real (`^0.1.0`).
3. Imprime los pasos siguientes (`cd`, `bun install`, `bun start`).

Si el directorio destino ya existe y no está vacío, el comando se cancela sin modificar nada.

## Opciones

```bash
create-iskra [directory] [--template <name>] [--yes]
```

| Opción | Descripción |
| --- | --- |
| `[directory]` | Directorio donde crear el proyecto. Se solicita si no se indica. |
| `-t, --template <name>` | Plantilla a usar. Por defecto: `starter-app`. |
| `-y, --yes` | Aceptar los valores por defecto sin preguntar. |
| `-h, --help` | Mostrar la ayuda. |

## Plantillas incluidas

- `starter-app` — servidor web mínimo con gestión de usuarios (por defecto).
- `simple-server` — servidor HTTP mínimo.

Hay más plantillas en camino.

## API Programática

La lógica de copia es importable y no depende del prompt interactivo:

```typescript
import { scaffold } from 'create-iskra';

scaffold({
    template: 'starter-app',
    targetDir: './my-app',
    projectName: 'my-app',
    templatesRoot: '/path/to/templates',
});
```
