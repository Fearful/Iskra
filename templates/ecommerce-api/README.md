# Ecommerce API

Template para un backend de e-commerce con catalogo de productos, gestion de ordenes, persistencia en base de datos y cache. Listo para usar como punto de partida de una API REST completa.

## Kits utilizados

- [`@iskra-bun/core`](https://iskra-docs.fly.dev/es/packages/core/) — Clase App, ciclo de vida, logger
- [`@iskra-bun/web-kit`](https://iskra-docs.fly.dev/es/packages/web-kit/) — Servidor HTTP con Hono
- [`@iskra-bun/db-kit`](https://iskra-docs.fly.dev/es/packages/db-kit/) — Base de datos con Drizzle ORM (SQLite por defecto)
- [`@iskra-bun/kv-kit`](https://iskra-docs.fly.dev/es/packages/kv-kit/) — Cache en memoria o Redis

## Inicio rapido

```bash
# Desde la raiz del monorepo
bun install

cd templates/ecommerce-api
bun dev
```

El servidor levanta en `http://localhost:3000`.

## Variables de entorno

Copia `.env.example` a `.env`:

| Variable | Descripcion | Default |
|----------|-------------|---------|
| `PORT` | Puerto del servidor HTTP | `3000` |
| `DATABASE_URL` | Ruta o URL de la base de datos | `ecommerce.db` (en la imagen Docker, `/app/data/ecommerce.db`) |

## Endpoints

### Productos

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| `GET` | `/products` | Listar todos los productos |
| `GET` | `/products/:id` | Obtener producto por ID |
| `POST` | `/products` | Crear un producto nuevo |

### Ordenes

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| `GET` | `/orders` | Listar todas las ordenes |
| `POST` | `/orders` | Crear una orden (valida stock disponible) |

## Estructura del proyecto

```
src/
├── main.ts                          # Punto de entrada
├── app.config.ts                    # Configuracion con Zod
├── domain/
│   ├── products/
│   │   ├── product.model.ts         # Modelo y schema de productos
│   │   └── product.service.ts       # Logica de negocio de productos
│   └── orders/
│       ├── order.model.ts           # Modelo y schema de ordenes
│       └── order.service.ts         # Logica de negocio de ordenes
└── interfaces/
    └── http/
        └── router.ts                # Rutas HTTP
```

## Base de datos

Por defecto usa SQLite (`ecommerce.db`), pero podes cambiar a PostgreSQL o MySQL modificando la configuracion del driver. Mira la [documentacion de DB Kit](https://iskra-docs.fly.dev/es/packages/db-kit/) para los drivers disponibles.

Para manejar migraciones de schema, revisa la [guia de migraciones](https://iskra-docs.fly.dev/es/guides/migrations/).

## Despliegue

Incluye `Dockerfile` con build multi-stage. Mas info en la [guia de despliegue](https://iskra-docs.fly.dev/es/guides/deployment/).

```bash
# Desde la raiz del monorepo: el Dockerfile necesita todo el workspace
docker build -f templates/ecommerce-api/Dockerfile -t ecommerce-api .
# La base SQLite queda en /app/data: con un volumen sobrevive a los reinicios
docker run -p 3000:3000 -v ecommerce-api-data:/app/data ecommerce-api
```
