---
title: Config Kit
description: Carga de configuración de entorno tipada y validada con Zod.
---

Carga de configuración de entorno tipada y validada con Zod.

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

Bun carga automáticamente `.env` en `process.env`; `loadConfig` lo lee por defecto sin configuración adicional.

## loadConfig

```typescript
function loadConfig<TSchema extends z.ZodTypeAny>(options: {
    schema: TSchema;
    source?: Record<string, string | undefined>;
}): z.output<TSchema>
```

- Valida `source` (por defecto `process.env`) contra el esquema Zod.
- Devuelve un objeto de configuración tipado y congelado en profundidad (completamente inmutable).
- En caso de fallo: lanza `ConfigError` listando cada campo inválido o ausente por nombre y motivo — sin exponer nunca los valores secretos.

## Coercers

Los coercers transforman las variables de entorno de tipo string al tipo correcto con mensajes de error claros.

### envBool

Acepta `"true"/"1"/"yes"` → `true` y `"false"/"0"/"no"` → `false`.

```typescript
const schema = z.object({ FEATURE_X: envBool });
```

### envNumber

Coerciona cualquier cadena numérica a `number` (entero o decimal).

```typescript
const schema = z.object({ TIMEOUT_MS: envNumber });
```

### envPort

Coerciona a un `number` entero entre 1 y 65535.

```typescript
const schema = z.object({ PORT: envPort });
```

### envEnum

Restringe el valor a una lista de literales de cadena.

```typescript
const schema = z.object({
    LOG_LEVEL: envEnum(['debug', 'info', 'warn', 'error'] as const),
});
```

## fromEnv: la sección de un kit desde tus nombres de variables

Cada kit lee su sección de `app.config` (`oracle`, `kv`, `db`…) con sus propias claves. `fromEnv()` arma esa sección desde las variables de entorno que un servicio ya tiene, así migrarlo no obliga a renombrarlas:

```typescript
// app.config.ts
import { env, envEnum, envNumber, envPort, fromEnv } from '@iskra-bun/config-kit';

export default {
    oracle: fromEnv({
        host: 'DB_HOST_ORACLE', // sólo un nombre: texto, obligatorio
        port: env('DB_PORT_ORACLE', envPort, { default: 1521 }),
        serviceName: env(['DB_SERVICE_ORACLE', 'ORA_SERVICE']), // gana la primera definida
        user: 'DB_USER_ORACLE',
        password: 'DB_PASS_ORACLE',
        pool: { max: env('DB_POOL_MAX', envNumber, { default: 4 }) },
    }),
    kv: fromEnv({ driver: env('KV_DRIVER', envEnum(['memory', 'redis']), { default: 'redis' }), connection: 'REDIS_URL' }),
};
```

- `env(names, parser?, { default } | { optional: true })`: la variable (o la primera definida de varias: un nombre nuevo y después el heredado; un valor vacío cuenta como no definido), convertida por un coercer o cualquier schema de Zod de un string. Sin valor y sin `default` un campo es un error, salvo que sea `optional`, que deja afuera su clave.
- La sección queda tipada según la especificación, y cada kit sigue validando su sección al arrancar.
- Todos los problemas llegan juntos en un `ConfigError` que nombra las variables (`DB_HOST_ORACLE is not set`, `DB_PORT_ORACLE: Expected a port number`), nunca sus valores.

## Manejo de Errores

`loadConfig` lanza `ConfigError` (de `@iskra-bun/core`) con todos los problemas en un único mensaje:

```
Config validation failed:
  • DATABASE_URL: Invalid url
  • PORT: Expected a port number (1–65535), received "99999"
  • NODE_ENV: Expected one of ["development", "production", "test"], received "staging"
```

Los valores de los campos nunca se incluyen en el mensaje de error (protección de secretos).

## Variables de Entorno

```bash
DATABASE_URL=postgres://localhost:5432/mydb
PORT=3000
DEBUG=true
NODE_ENV=production
```
