# create-iskra

Andamiaje de proyectos [Iskra](https://github.com/fearful/iskra). Crea un proyecto nuevo a partir de un template oficial con un solo comando.

## Uso

```bash
bun create iskra mi-app
```

O eligiendo el template y aceptando los valores por defecto:

```bash
bun create iskra mi-app --template simple-server --yes
```

Tambien funciona con npm:

```bash
npm create iskra@latest mi-app
```

## Que hace

1. Copia el template elegido a `mi-app/` (excluyendo `node_modules`, `dist` y `.git`).
2. Reescribe el `package.json` del proyecto: ajusta el `name` al nombre del directorio y reemplaza las dependencias `@iskra-bun/* : workspace:*` por un rango real (`^0.1.0`).
3. Imprime los proximos pasos (`cd`, `bun install`, `bun start`).

Si el directorio destino ya existe y no esta vacio, el comando se aborta sin tocar nada.

## Opciones

| Opcion | Descripcion |
| --- | --- |
| `[directorio]` | Directorio donde crear el proyecto. Si falta, se pregunta. |
| `-t, --template <nombre>` | Template a usar. Default: `starter-app`. |
| `-y, --yes` | Acepta los valores por defecto sin preguntar. |
| `-h, --help` | Muestra la ayuda. |

## Templates incluidos

- `starter-app` — servidor web minimo con gestion de usuarios (default).
- `simple-server` — servidor HTTP minimo.

> Mas templates iran llegando. Por ahora el paquete incluye un set chico para mantener la instalacion liviana.

## Uso programatico

La logica pura es importable y no depende del prompt interactivo:

```typescript
import { scaffold, listTemplates } from 'create-iskra';

const result = scaffold({
    template: 'starter-app',
    targetDir: './mi-app',
    projectName: 'mi-app',
    templatesRoot: '/ruta/a/templates',
});
```

## Licencia

AGPL-3.0-or-later
