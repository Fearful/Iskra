# @iskra-bun/config-kit

Carga y validacion tipada de configuracion de entorno con Zod.

## Inicio Rapido

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
```

Bun carga `.env` automaticamente; `loadConfig` lee `process.env` por defecto.

## loadConfig

```typescript
function loadConfig<TSchema extends z.ZodTypeAny>(options: {
    schema: TSchema;
    source?: Record<string, string | undefined>;
}): z.output<TSchema>
```

- Valida `source` (por defecto `process.env`) contra el esquema Zod.
- Devuelve un objeto tipado y deep-frozen (inmutable).
- En caso de error: lanza `ConfigError` listando cada campo invalido o ausente por nombre y razon — nunca expone los valores secretos.

## Coercers

Los coercers transforman strings de entorno al tipo correcto con mensajes de error claros.

### envBool

Acepta `"true"/"1"/"yes"` → `true` y `"false"/"0"/"no"` → `false`.

```typescript
const schema = z.object({ FEATURE_X: envBool });
```

### envNumber

Coerce cualquier string numerica a `number` (entero o decimal).

```typescript
const schema = z.object({ TIMEOUT_MS: envNumber });
```

### envPort

Coerce a `number` entero entre 1 y 65535.

```typescript
const schema = z.object({ PORT: envPort });
```

### envEnum

Restringe el valor a una lista de literales.

```typescript
const schema = z.object({
    LOG_LEVEL: envEnum(['debug', 'info', 'warn', 'error'] as const),
});
```

## Manejo de Errores

`loadConfig` lanza `ConfigError` (de `@iskra-bun/core`) con todos los problemas en un solo mensaje:

```
Config validation failed:
  • DATABASE_URL: Invalid url
  • PORT: Expected a port number (1–65535), received "99999"
  • NODE_ENV: Expected one of ["development", "production", "test"], received "staging"
```

Los valores de los campos nunca aparecen en el error (proteccion de secretos).

## Variables de Entorno de Ejemplo

```bash
DATABASE_URL=postgres://localhost:5432/mydb
PORT=3000
DEBUG=true
NODE_ENV=production
```
