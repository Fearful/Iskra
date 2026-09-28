# DB Starter

Template con CRUD de usuarios usando SQLite (via Drizzle ORM) y soporte opcional para Oracle Database. Ideal para aprender la integracion con bases de datos en Iskra.

## Kits utilizados

- [`@iskra-bun/core`](https://iskra-docs.fly.dev/es/packages/core/) — Clase App, ciclo de vida, logger
- [`@iskra-bun/web-kit`](https://iskra-docs.fly.dev/es/packages/web-kit/) — Servidor HTTP
- [`@iskra-bun/db-kit`](https://iskra-docs.fly.dev/es/packages/db-kit/) — Base de datos SQL con Drizzle ORM
- [`@iskra-bun/db-oracle`](https://iskra-docs.fly.dev/es/packages/db-oracle/) — Oracle Database (opcional): Kysely, busqueda, paginacion y migraciones

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
| `ORA_CONN` | Connection string de Oracle (opcional; sin ella el `OracleDriver` no arranca), p. ej. `localhost:1521/XEPDB1` | — |
| `ORA_USER` | Usuario de Oracle: uno propio de la app con permisos minimos, nunca `SYSTEM`/`SYS` | — |
| `ORA_PASSWORD` | Password de Oracle | — |

## Endpoints

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| `GET` | `/users` | Listar los usuarios (`id` y `name`: los emails no se exponen) |
| `GET` | `/oracle/users` | Usuarios de Oracle paginados: `?q=ana&sort=-name&page=2&pageSize=20` (503 sin Oracle) |
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
│   ├── user.service.ts              # Logica de negocio (CRUD)
│   └── oracle-user.service.ts       # Listado de Oracle: busqueda, orden y paginacion
└── interfaces/
    └── http/
        └── router.ts                # Rutas HTTP
migrations/
└── oracle/                          # Migraciones SQL de Oracle (runMigrations)
```

## Oracle (opcional)

Si defines `ORA_CONN`, `ORA_USER` y `ORA_PASSWORD` en `.env`, el `OracleDriver` abre un pool de node-oracledb (modo Thin, sin Oracle Client) al arrancar la app, aplica las migraciones de `migrations/oracle` y sirve `GET /oracle/users`. Sin `ORA_CONN` se omite (con un aviso en el log) y esa ruta responde 503. Si no puede conectarse, la app no arranca.

`GET /oracle/users` busca por nombre sin distinguir mayusculas (`q`), ordena por `sort` (`name` o `-name`) y pagina con `page` y `pageSize` (hasta 100): ver `src/domain/oracle-user.service.ts`. Para una base local, [gvenzl/oracle-free](https://hub.docker.com/r/gvenzl/oracle-free) crea el usuario con `APP_USER` y `APP_USER_PASSWORD` (`ORA_CONN=localhost:1521/FREEPDB1`).

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
