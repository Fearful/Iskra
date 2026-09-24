# CMS Starter

Sistema de gestion de contenido (CMS) con API REST sobre SQLite. Maneja posts y
paginas con **flujo draft/publish**, **versionado de contenido** y **gestion de
slugs con validacion** (Zod). Persistencia real con Drizzle ORM via `@iskra-bun/db-kit`.

## Kits utilizados

- [`@iskra-bun/core`](https://iskra-docs.fly.dev/es/packages/core/) — Clase App, ciclo de vida, logger
- [`@iskra-bun/web-kit`](https://iskra-docs.fly.dev/es/packages/web-kit/) — Servidor HTTP con Hono
- [`@iskra-bun/db-kit`](https://iskra-docs.fly.dev/es/packages/db-kit/) — Base de datos SQLite con Drizzle ORM

## Inicio rapido

```bash
# Desde la raiz del monorepo
bun install

cd templates/cms-starter
cp .env.example .env   # opcional
bun dev
```

El servidor levanta en `http://localhost:3000`. Por defecto usa el archivo SQLite
`cms.db`; poné `DATABASE_URL=:memory:` para una base efímera en cada arranque.

## Variables de entorno

| Variable | Descripcion | Default |
|----------|-------------|---------|
| `PORT` | Puerto del servidor HTTP | `3000` |
| `DATABASE_URL` | Ruta del archivo SQLite (o `:memory:`) | `cms.db` (en la imagen Docker, `/app/data/cms.db`) |

## Funcionalidades

### Flujo draft / publish

Todo contenido nace en estado `draft`. Se publica con `POST /content/:id/publish`
(setea `status: "published"` y `publishedAt`) y se vuelve a borrador con
`POST /content/:id/unpublish`. El listado se puede filtrar por estado con
`?status=draft|published`, util para separar el panel de edicion del sitio publico.

### Versionado de contenido

Cada cambio relevante (crear, actualizar, publicar, despublicar) incrementa el
campo `version` y deja una fila **inmutable** en la tabla `content_versions`. El
historial completo se consulta con `GET /content/:id/versions`, ordenado de la
version mas nueva a la mas vieja. Sirve de pista de auditoria y base para un
futuro "restaurar version".

### Gestion de slugs con validacion

El slug se valida con Zod (`SlugSchema`): minusculas, numeros y guiones, sin
guiones al inicio/fin (ej. `mi-primer-post`). Es **unico** a nivel base de datos;
crear o renombrar a un slug existente devuelve `409 Conflict`. El helper
`slugify(title)` genera un candidato a partir del titulo.

## Endpoints

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| `GET` | `/content` | Listar (filtros `?type=post\|page`, `?status=draft\|published`) |
| `GET` | `/content/:id` | Obtener un documento por ID |
| `GET` | `/content/:id/versions` | Historial de versiones del documento |
| `POST` | `/content` | Crear contenido (nace en `draft`) |
| `PUT` | `/content/:id` | Actualizar (genera nueva version) |
| `POST` | `/content/:id/publish` | Publicar (draft → published) |
| `POST` | `/content/:id/unpublish` | Despublicar (published → draft) |
| `DELETE` | `/content/:id` | Eliminar contenido y su historial |

Codigos de error: `400` (slug/payload invalido), `404` (no encontrado),
`409` (slug en uso), `422` (transicion de estado invalida).

### Ejemplo de uso

```bash
# Crear (queda en draft)
curl -X POST http://localhost:3000/content \
  -H 'content-type: application/json' \
  -d '{"slug":"mi-primer-post","title":"Hola","body":"Contenido","type":"post"}'

# Publicar (usá el id devuelto arriba)
curl -X POST http://localhost:3000/content/<id>/publish

# Ver historial de versiones
curl http://localhost:3000/content/<id>/versions

# Listar solo lo publicado
curl 'http://localhost:3000/content?status=published'
```

## Estructura del proyecto

```
src/
├── main.ts                          # Punto de entrada: DbDriver + WebPlugin + init de tablas
├── app.config.ts                    # Configuracion con Zod (web + db)
├── db/
│   └── schema.ts                    # Tablas Drizzle: content, content_versions
├── domain/
│   └── content/
│       ├── content.model.ts         # Schemas Zod (slug, create/update) + slugify
│       └── content.service.ts       # Workflow, versionado, unicidad de slug
└── interfaces/
    └── http/
        └── router.ts                # Rutas HTTP (Hono + zValidator)
```

## Despliegue

Incluye un `Dockerfile` con build multi-stage. Mas detalles en la
[guia de despliegue](https://iskra-docs.fly.dev/es/guides/deployment/).

```bash
# Desde la raiz del monorepo: el Dockerfile necesita todo el workspace
docker build -f templates/cms-starter/Dockerfile -t cms-starter .
# La base SQLite queda en /app/data: con un volumen sobrevive a los reinicios
docker run -p 3000:3000 -v cms-starter-data:/app/data cms-starter
```
