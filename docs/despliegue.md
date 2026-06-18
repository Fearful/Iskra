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

### `release.yml` — Publicacion

Se dispara al pushear un tag `v*` (ej: `v0.1.0`). Pasos:

1. Build de los paquetes (ejecuta el script `build` de cada paquete si existe).
2. `npm publish --provenance --access public` para cada paquete **publico**
   `@iskra-bun/*`. Los paquetes marcados `private` se saltean.
3. Crea un **GitHub Release** con notas generadas automaticamente.

> **Nota (Fase 5):** la integracion con Changesets (el "version PR" que bumpea
> versiones y changelogs, y cuyo merge genera el tag) se finaliza en la Fase 5.
> La estrategia de build a `dist/` tambien se define en la Fase 5; por ahora los
> paquetes publican su codigo TypeScript fuente directamente.

Requiere los secrets `NPM_TOKEN` (publish) y usa el `GITHUB_TOKEN` automatico
para el Release. El permiso `id-token: write` habilita la procedencia
(provenance) de npm.

### `mirror.yml` — Espejo en Codeberg

En cada push a `main` y en cada tag, hace un `git push --mirror --force` hacia
`codeberg.org/fearful/iskra`. Requiere el secret `CODEBERG_DEPLOY_KEY` (clave SSH
privada cuya parte publica se carga como Deploy Key con escritura en el repo de
Codeberg).

### Flujo de Trabajo

1. Abris un PR → corre `ci.yml` (lint, typecheck, tests con servicios, cobertura).
2. Merge a `main` → corre `ci.yml` y `mirror.yml` (actualiza el espejo en Codeberg).
3. Creas un tag `v0.1.0` → corre `release.yml` (publica a npm + GitHub Release) y
   `mirror.yml` (espeja el tag).
