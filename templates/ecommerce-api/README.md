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
# Un admin y un cliente, con claves aleatorias (openssl rand -hex 32)
export API_KEYS="admin-1:admin:$(openssl rand -hex 32),ana:customer:$(openssl rand -hex 32)"
bun dev
```

El servidor levanta en `http://localhost:3000`, con las rutas bajo `/api`.

## Variables de entorno

Copia `.env.example` a `.env`:

| Variable | Descripcion | Default |
|----------|-------------|---------|
| `PORT` | Puerto del servidor HTTP | `3000` |
| `DATABASE_URL` | Ruta o URL de la base de datos | `ecommerce.db` (en la imagen Docker, `/app/data/ecommerce.db`) |
| `API_KEYS` | Usuarios de la API: `<userId>:<rol>:<clave>` separados por comas (ver Autenticacion) | — (sin claves solo responde el catalogo) |

## Autenticacion

La API usa el `ApiKeyFeature` de web-kit ([`src/auth.ts`](./src/auth.ts)). Cada clave de
`API_KEYS` identifica a un usuario y le da un rol:

| Rol | Puede |
|-----|-------|
| `admin` | Crear productos, crear ordenes y ver las de todos |
| `customer` | Crear ordenes a su nombre y ver solo las suyas |

Las claves se mandan en `X-API-Key: <clave>` (o `Authorization: Bearer <clave>`), deben
tener al menos 32 caracteres (`openssl rand -hex 32`) y una entrada mal formada corta el
arranque. El catalogo (`GET /api/products`) es publico; sin clave, lo demas responde `401`,
y con una clave sin permiso, `403`. El `userId` de una orden sale de la clave, no del
cuerpo.

Para que los usuarios finales inicien sesion con email y password, reemplaza las claves
por el [`AuthFeature`](https://iskra-docs.fly.dev/es/packages/web-kit/) (Better Auth) y toma
el usuario de `c.get('user').id` en lugar de `currentUserId(c)`.

## Endpoints

### Productos

| Metodo | Ruta | Acceso | Descripcion |
|--------|------|--------|-------------|
| `GET` | `/api/products` | Publico | Listar todos los productos |
| `GET` | `/api/products/:id` | Publico | Obtener producto por ID |
| `POST` | `/api/products` | `admin` | Crear un producto nuevo |

### Ordenes

| Metodo | Ruta | Acceso | Descripcion |
|--------|------|--------|-------------|
| `GET` | `/api/orders` | Con clave | Las ordenes propias (`admin`: todas) |
| `POST` | `/api/orders` | Con clave | Crear una orden `{ items: [{ productId, quantity }] }` (valida stock disponible) |

Una orden lleva hasta 20 lineas, 20 unidades por linea y 50 unidades en total, asi una
sola orden no reserva todo el stock.

```bash
curl -X POST http://localhost:3000/api/orders \
  -H "X-API-Key: $CLAVE_DE_ANA" -H 'content-type: application/json' \
  -d '{"items":[{"productId":"<id>","quantity":2}]}'
```

> **Limitacion conocida:** una orden `pending` descuenta el stock al crearse y el template
> no tiene flujo de pago ni vencimiento, asi que las ordenes que nunca se pagan dejan ese
> stock reservado para siempre. Antes de produccion agrega la confirmacion de pago y un job
> que cancele las ordenes `pending` viejas devolviendo su stock (y, si hace falta, un tope
> de ordenes abiertas por usuario).

## Estructura del proyecto

```
src/
├── main.ts                          # Punto de entrada
├── app.config.ts                    # Configuracion con Zod
├── auth.ts                          # API keys (API_KEYS) y roles
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
docker run -p 3000:3000 -v ecommerce-api-data:/app/data -e API_KEYS="..." ecommerce-api
```
