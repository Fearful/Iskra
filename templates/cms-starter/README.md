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
export API_KEYS="ana:editor:$(openssl rand -hex 32)"   # un editor
bun dev
```

El servidor levanta en `http://localhost:3000`. Por defecto usa el archivo SQLite
`cms.db`; poné `DATABASE_URL=:memory:` para una base efímera en cada arranque.

## Variables de entorno

| Variable | Descripcion | Default |
|----------|-------------|---------|
| `PORT` | Puerto del servidor HTTP | `3000` |
| `DATABASE_URL` | Ruta del archivo SQLite (o `:memory:`) | `cms.db` (en la imagen Docker, `/app/data/cms.db`) |
| `API_KEYS` | Editores: `<editorId>:editor:<clave>` separados por comas | — (sin claves solo se lee lo publicado) |

## Autenticacion

El sitio publico lee sin credenciales, pero solo ve contenido **publicado**: el filtro
se aplica en el servidor, asi que `GET /content` no devuelve borradores aunque se pidan
con `?status=draft`, y `GET /content/:id` responde `404` para un borrador. Crear,
editar, publicar, despublicar, borrar y leer borradores o el historial exige una clave
de editor (`ApiKeyFeature` de web-kit, ver [`src/auth.ts`](./src/auth.ts)), en
`X-API-Key: <clave>` o `Authorization: Bearer <clave>`: sin clave responde `401`.

Las claves se configuran en `API_KEYS`, deben tener al menos 32 caracteres
(`openssl rand -hex 32`) y una entrada mal formada corta el arranque. Para un panel con
login de usuarios, reemplazalas por el
[`AuthFeature`](https://iskra-docs.fly.dev/es/packages/web-kit/) (Better Auth).

Publicar y despublicar exigen `Content-Type: application/json` (si no, `415`): un
formulario HTML de otro sitio no puede mandarlo, asi que no podria dispararlos aunque la
app pase a autenticar con cookies.

## Funcionalidades

### Flujo draft / publish

Todo contenido nace en estado `draft`. Se publica con `POST /content/:id/publish`
(setea `status: "published"` y `publishedAt`) y se vuelve a borrador con
`POST /content/:id/unpublish`. Los editores pueden filtrar el listado por estado con
`?status=draft|published`; el publico recibe siempre solo lo publicado.

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

| Metodo | Ruta | Acceso | Descripcion |
|--------|------|--------|-------------|
| `GET` | `/content` | Publico | Listar (filtro `?type=post\|page`; editores: tambien `?status=draft\|published`) |
| `GET` | `/content/:id` | Publico | Obtener un documento publicado por ID (editores: tambien borradores) |
| `GET` | `/content/:id/versions` | Editor | Historial de versiones del documento |
| `POST` | `/content` | Editor | Crear contenido (nace en `draft`) |
| `PUT` | `/content/:id` | Editor | Actualizar (genera nueva version) |
| `POST` | `/content/:id/publish` | Editor | Publicar (draft → published) |
| `POST` | `/content/:id/unpublish` | Editor | Despublicar (published → draft) |
| `DELETE` | `/content/:id` | Editor | Eliminar contenido y su historial |

Codigos de error: `400` (slug/payload invalido), `401` (falta la clave de editor),
`404` (no encontrado), `409` (slug en uso), `415` (publicar sin JSON), `422` (transicion
de estado invalida).

### Ejemplo de uso

```bash
CLAVE=...   # la clave de editor de API_KEYS

# Crear (queda en draft)
curl -X POST http://localhost:3000/content \
  -H "X-API-Key: $CLAVE" -H 'content-type: application/json' \
  -d '{"slug":"mi-primer-post","title":"Hola","body":"Contenido","type":"post"}'

# Publicar (usá el id devuelto arriba)
curl -X POST http://localhost:3000/content/<id>/publish \
  -H "X-API-Key: $CLAVE" -H 'content-type: application/json'

# Ver historial de versiones
curl http://localhost:3000/content/<id>/versions -H "X-API-Key: $CLAVE"

# Lo que ve el sitio publico: solo lo publicado
curl http://localhost:3000/content
```

## Estructura del proyecto

```
src/
├── main.ts                          # Punto de entrada: DbDriver + WebPlugin + init de tablas
├── app.config.ts                    # Configuracion con Zod (web + db)
├── auth.ts                          # Claves de editor (API_KEYS)
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
docker run -p 3000:3000 -v cms-starter-data:/app/data -e API_KEYS="..." cms-starter
```
