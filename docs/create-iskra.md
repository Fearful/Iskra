# create-iskra

Andamiaje de proyectos Iskra. Crea un proyecto nuevo a partir de un template oficial con un solo comando.

## Inicio Rapido

```bash
bun create iskra mi-app
```

El comando pregunta por el directorio y el template si no se los pasas, copia el template elegido y deja el proyecto listo para `bun install`.

Modo no interactivo:

```bash
bun create iskra mi-app --template simple-server --yes
```

Tambien funciona con npm:

```bash
npm create iskra@latest mi-app
```

## Que hace

1. Copia el template elegido a `mi-app/`, excluyendo `node_modules`, `dist` y `.git`.
2. Reescribe el `package.json`: ajusta el `name` al nombre del directorio y reemplaza las dependencias `@iskra-bun/* : workspace:*` por un rango real sobre la versión actual de cada paquete (p. ej. `^0.2.0` para `web-kit`, `^0.1.1` para `core`).
3. Imprime los proximos pasos.

Si el directorio destino existe y no esta vacio, el comando aborta sin tocar nada.

## Opciones

```bash
create-iskra [directorio] [--template <nombre>] [--yes]
```

| Opcion | Descripcion |
| --- | --- |
| `[directorio]` | Directorio donde crear el proyecto. Si falta, se pregunta. |
| `-t, --template <nombre>` | Template a usar. Default: `starter-app`. |
| `-y, --yes` | Acepta los valores por defecto sin preguntar. |
| `-h, --help` | Muestra la ayuda. |

## Templates incluidos

- `starter-app` — servidor web minimo con gestion de usuarios (default).
- `simple-server` — servidor HTTP minimo.

Mas templates iran llegando en proximas versiones.

## API programatica

La logica de copiado es importable y no depende del prompt interactivo:

```typescript
import { scaffold } from 'create-iskra';

scaffold({
    template: 'starter-app',
    targetDir: './mi-app',
    projectName: 'mi-app',
    templatesRoot: '/ruta/a/templates',
});
```
