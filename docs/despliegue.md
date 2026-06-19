# Despliegue

Guia para construir imagenes Docker y entender la pipeline de CI/CD en GitHub Actions.

## Docker

Cada template incluye un `Dockerfile` que usa builds multi-stage:

1. **Stage 1 (Builder):** Usa `oven/bun:1` para instalar dependencias y compilar a binario standalone con `bun build --compile`.
2. **Stage 2 (Runtime):** Usa `ubi9/ubi-minimal` de Red Hat como imagen minima de produccion.

### Construir una Imagen

Desde la raiz del monorepo:

```bash
# Ecommerce API
docker build -f templates/ecommerce-api/Dockerfile -t iskra-ecommerce:latest .

# Job Worker
docker build -f templates/job-worker/Dockerfile -t iskra-worker:latest .

# Realtime Feed
docker build -f templates/realtime-feed/Dockerfile -t iskra-realtime:latest .
```

### Correr un Contenedor

```bash
docker run -p 3000:3000 \
    -e PORT=3000 \
    -e DATABASE_URL=app.db \
    iskra-ecommerce:latest
```

### Dockerfile.base

Si necesitas crear un Dockerfile para un template nuevo, podes usar `Dockerfile.base` como referencia. Acepta `ARG TEMPLATE_NAME` y `ARG ENTRY_POINT`.

## CI/CD con GitHub Actions

La pipeline vive en `.github/workflows/` y se compone de tres workflows
independientes: `ci.yml`, `release.yml` y `mirror.yml`.

### `ci.yml` — Integracion Continua

Se ejecuta en cada **pull request** y en cada **push a `main`**. Pasos:

```
checkout → setup-bun → bun install --frozen-lockfile → lint → typecheck → test --coverage → upload coverage
```

Para que los tests de integracion (Redis, Postgres y MySQL) dejen de saltearse,
el job levanta **service containers** y expone las variables de entorno que esos
tests leen para detectar servicios disponibles:

| Servicio | Imagen | Variable de entorno |
|----------|--------|---------------------|
| Redis | `redis:7` | `TEST_REDIS_URL=redis://127.0.0.1:6379` |
| Postgres | `postgres:16` | `TEST_PG_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres` |
| MySQL | `mysql:8` | `TEST_MYSQL_URL=mysql://root:mysql@127.0.0.1:3306/test` |

Las credenciales coinciden exactamente con los valores por defecto de los
archivos de test, por lo que los bloques `describe()` gateados se activan en CI.

La cobertura se sube a [Codecov](https://codecov.io) con
`codecov/codecov-action`. Es **informativa** por ahora (objetivo inicial ~70%,
configurado en `codecov.yml` con `informational: true`), asi que no bloquea el
merge. Requiere el secret `CODECOV_TOKEN`.

### `release.yml` — Publicacion (con Changesets)

Se ejecuta en cada **push a `main`** y usa [Changesets](https://github.com/changesets/changesets).
Hace una de dos cosas:

1. Si hay **changesets pendientes**, abre/actualiza un PR **"Version Packages"**
   que los consume: bumpea la version de cada paquete `@iskra-bun/*` afectado,
   actualiza su `CHANGELOG.md` y borra los changesets. Mergear ese PR es la
   compuerta humana de "publicar release".
2. Si **no hay changesets pendientes** (es decir, recien se mergeo el version PR),
   ejecuta el script `release`: compila cada paquete a `dist/` y luego
   `changeset publish` publica a npm con procedencia (provenance) los paquetes
   publicos, y crea los **GitHub Releases** correspondientes.

Las versiones y changelogs nunca se editan a mano: salen de los archivos de
changeset que agregan los contribuyentes (ver `CONTRIBUTING.md` / `VERSIONING.md`).

Cada paquete publica un `dist/` compilado (JS ESM + `.d.ts`, generado con tsup);
el `exports` resuelve a `dist/` para consumidores npm/Node y a `src/` (condicion
`source`/`bun`) para desarrollo con Bun sin necesidad de build.

Requiere el secret `NPM_TOKEN` (publish) y usa el `GITHUB_TOKEN` automatico para
el version PR y los Releases. El permiso `id-token: write` habilita la procedencia
(provenance) de npm.

### `mirror.yml` — Espejo en Codeberg

En cada push a `main` y en cada tag, hace un `git push --mirror --force` hacia
`codeberg.org/fearful/iskra`. Requiere el secret `CODEBERG_DEPLOY_KEY` (clave SSH
privada cuya parte publica se carga como Deploy Key con escritura en el repo de
Codeberg).

### Flujo de Trabajo

1. Abris un PR (con un changeset) → corre `ci.yml` (lint, typecheck, tests con
   servicios, cobertura).
2. Merge a `main` → corre `ci.yml`, `mirror.yml` (actualiza el espejo en Codeberg)
   y `release.yml` (abre el PR **"Version Packages"** si hay changesets pendientes).
3. Mergeas el PR "Version Packages" → `release.yml` compila y publica a npm +
   crea los GitHub Releases; `mirror.yml` espeja los cambios.
