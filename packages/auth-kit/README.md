# @iskra-bun/auth-kit

Integracion de autenticacion de Iskra basada en [better-auth](https://www.better-auth.com/), agnostica del transporte.

Expone el setup portable de better-auth (la fabrica de configuracion, el esquema Drizzle de auth y los tipos compartidos) para que servicios que no son HTTP puedan reutilizar la logica de sesiones y autenticacion sin depender de Hono.

## Instalacion

```bash
bun add @iskra-bun/auth-kit @iskra-bun/core
```

## Uso rapido

```typescript
import { createBetterAuth } from '@iskra-bun/auth-kit'

const auth = createBetterAuth({
    db,                       // instancia de Drizzle
    adapterType: 'postgres',  // 'postgres' | 'mysql' | 'sqlite'
    secret: process.env.AUTH_SECRET!,
})

// auth.handler / auth.api.getSession quedan disponibles para cualquier transporte
```

El esquema Drizzle (`pgSchema`, `mysqlSchema`, `sqliteSchema`) y los tipos (`User`, `AuthSession`, ...) tambien se exportan para reutilizarlos en migraciones y handlers.

## Documentacion

Guia completa: [docs/auth-kit.md](../../docs/auth-kit.md)

## Licencia

AGPL-3.0-or-later
