# DB Starter

Template con CRUD de usuarios usando SQLite (via Drizzle ORM) y soporte opcional para Oracle Database. Ideal para aprender la integracion con bases de datos en Iskra.

## Kits utilizados

- [`@iskra-bun/core`](https://iskra-docs.fly.dev/es/packages/core/) — Clase App, ciclo de vida, logger
- [`@iskra-bun/web-kit`](https://iskra-docs.fly.dev/es/packages/web-kit/) — Servidor HTTP
- [`@iskra-bun/db-kit`](https://iskra-docs.fly.dev/es/packages/db-kit/) — Base de datos SQL con Drizzle ORM
- [`@iskra-bun/db-oracle`](https://iskra-docs.fly.dev/es/packages/db-kit/) — Oracle Database (opcional, via Bridge/Sidecar)

## Inicio rapido

```bash
# Desde la raiz del monorepo
bun install

cd templates/db-starter
bun start
```

El servidor levanta en `http://localhost:3000`.

## Variables de entorno

| Variable | Descripcion | Default |
|----------|-------------|---------|
| `PORT` | Puerto del servidor HTTP | `3000` |
| `DATABASE_URL` | Ruta del archivo SQLite (o `:memory:`) | `:memory:` |
| `ORACLE_USER` | Usuario de Oracle (opcional): uno propio de la app con permisos minimos, nunca `SYSTEM`/`SYS` | — |
| `ORACLE_PASSWORD` | Password de Oracle (opcional) | — |
| `ORACLE_CONNECTION_STRING` | Connection string de Oracle (opcional) | — |

## Endpoints

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| `GET` | `/users` | Listar los usuarios (`id` y `name`: los emails no se exponen) |
| `POST` | `/users` | Crear un usuario (body: `{ "name": "...", "email": "..." }`, validado con Zod; `409` si el email ya existe) |

El listado es publico, asi que no devuelve emails. Si un panel necesita verlos, sumale
una ruta con autenticacion (por ejemplo con los features de auth de web-kit).

## Estructura del proyecto

```
src/
├── main.ts                          # Punto de entrada
├── db/
│   └── schema.ts                    # Schema Drizzle ORM (tabla users)
├── domain/
│   └── user.service.ts              # Logica de negocio (CRUD)
└── interfaces/
    └── http/
        └── router.ts                # Rutas HTTP
```

## Oracle (opcional)

Si configuras las variables `ORACLE_*` en `.env`, el `OracleDriver` se conecta automaticamente via el Bridge/Sidecar. Si no estan definidas, se omite sin errores.

Conectate con un usuario propio de la app, con solo los permisos que usa (`CREATE SESSION`
y los de sus tablas), nunca con `SYSTEM` o `SYS`:

```sql
CREATE USER app_user IDENTIFIED BY "<password larga y aleatoria>";
GRANT CREATE SESSION TO app_user;
-- y los permisos sobre sus tablas, por ejemplo:
GRANT SELECT, INSERT, UPDATE, DELETE ON app_schema.users TO app_user;
```

## Proximos pasos

A partir de aca podes:

- Agregar migraciones con [Drizzle Kit](https://iskra-docs.fly.dev/es/guides/migrations/)
- Cambiar a PostgreSQL o MySQL modificando la config de `db`
- Sumar cache con [`@iskra-bun/kv-kit`](https://iskra-docs.fly.dev/es/packages/kv-kit/)

## Despliegue

Incluye `Dockerfile` con build multi-stage. Mas info en la [guia de despliegue](https://iskra-docs.fly.dev/es/guides/deployment/).
