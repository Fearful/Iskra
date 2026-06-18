# Plugin Starter

Template para crear plugins (Drivers) reutilizables para Iskra. Usa esto como punto de partida cuando quieras encapsular funcionalidad en un modulo que se pueda registrar en cualquier aplicacion Iskra.

## Kits utilizados

- [`@iskra-bun/core`](../../docs/core.md) — Interfaz `Driver`, Clase App, logger

## Inicio rapido

```bash
# Desde la raiz del monorepo
bun install

cd templates/plugin-starter

# Compilar el plugin
bun run build
```

## Estructura del proyecto

```
src/
├── index.ts             # Re-exporta el driver
└── driver.ts            # Implementacion del Driver
```

## Como funciona

El plugin implementa la interfaz `Driver` de `@iskra-bun/core`, que define tres metodos de ciclo de vida:

- **`init(app)`** — Se ejecuta cuando la app inicializa. Aca recibis la instancia de `App` para acceder al logger, eventos, etc.
- **`start()`** — Se ejecuta cuando la app arranca.
- **`stop()`** — Se ejecuta cuando la app se detiene.

Ademas, podes agregar metodos propios que expongan la funcionalidad de tu plugin.

## Uso desde otra app

```typescript
import { App } from '@iskra-bun/core';
import { MyPluginDriver } from 'my-iskra-plugin';

const app = new App({ name: 'MiApp' });
app.register(new MyPluginDriver({ option: 'valor' }));

await app.start();
```

## Personalizacion

1. Renombra `MyPluginDriver` por el nombre de tu plugin
2. Ajusta la interfaz `MyPluginConfig` con las opciones que necesites
3. Implementa tu logica en los metodos de ciclo de vida y los metodos custom

Para entender mejor la arquitectura de plugins y drivers, revisa la [documentacion de arquitectura](../../docs/arquitectura.md).
