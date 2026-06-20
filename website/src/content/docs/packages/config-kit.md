---
title: Config Kit
description: Typed, validated environment config loading with Zod.
---

Typed, validated environment config loading with Zod.

## Quick Start

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

Bun auto-loads `.env` into `process.env`; `loadConfig` reads it by default with no extra setup.

## loadConfig

```typescript
function loadConfig<TSchema extends z.ZodTypeAny>(options: {
    schema: TSchema;
    source?: Record<string, string | undefined>;
}): z.output<TSchema>
```

- Validates `source` (defaults to `process.env`) against the Zod schema.
- Returns a typed, deep-frozen (fully immutable) config object.
- On failure: throws `ConfigError` listing every invalid or missing field by name and reason — never exposing secret values.

## Coercers

Coercers transform string env vars to the correct type with clear error messages.

### envBool

Accepts `"true"/"1"/"yes"` → `true` and `"false"/"0"/"no"` → `false`.

```typescript
const schema = z.object({ FEATURE_X: envBool });
```

### envNumber

Coerces any numeric string to `number` (integer or decimal).

```typescript
const schema = z.object({ TIMEOUT_MS: envNumber });
```

### envPort

Coerces to an integer `number` between 1 and 65535.

```typescript
const schema = z.object({ PORT: envPort });
```

### envEnum

Restricts the value to a list of string literals.

```typescript
const schema = z.object({
    LOG_LEVEL: envEnum(['debug', 'info', 'warn', 'error'] as const),
});
```

## Error Handling

`loadConfig` throws `ConfigError` (from `@iskra-bun/core`) with all problems in a single message:

```
Config validation failed:
  • DATABASE_URL: Invalid url
  • PORT: Expected a port number (1–65535), received "99999"
  • NODE_ENV: Expected one of ["development", "production", "test"], received "staging"
```

Field values are never included in the error message (secret protection).

## Environment Variables

```bash
DATABASE_URL=postgres://localhost:5432/mydb
PORT=3000
DEBUG=true
NODE_ENV=production
```
