# @iskra-bun/config-kit

Carga y validacion de configuracion de entorno con Zod para Iskra.

## Instalacion

```bash
bun add @iskra-bun/config-kit @iskra-bun/core
```

## Uso rapido

```typescript
import { loadConfig, envBool, envPort, envEnum, z } from '@iskra-bun/config-kit';

const config = loadConfig({
    schema: z.object({
        DATABASE_URL: z.string().url(),
        PORT: envPort,
        DEBUG: envBool,
        NODE_ENV: envEnum(['development', 'production', 'test'] as const),
    }),
});

// config es tipado, validado, y completamente inmutable (deep-frozen)
console.log(config.PORT); // number
console.log(config.DEBUG); // boolean
```

Bun carga `.env` automaticamente en `process.env`, por lo que `loadConfig` lo recoge sin configuracion adicional.

## Documentacion

Guia completa: [@iskra-bun/config-kit](https://iskra-docs.fly.dev/es/packages/config-kit/)

## Licencia

AGPL-3.0-or-later
