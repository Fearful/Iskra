# Despliegue

Guia para construir imagenes Docker y desplegar con GitLab CI/CD.

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

## GitLab CI/CD

La pipeline esta definida en `.gitlab-ci.yml` con 5 stages:

```
lint → test → build → docker-build → deploy
```

### Ambientes

| Branch/Tag | Ambiente | Tag Docker | Deploy |
|------------|----------|------------|--------|
| `develop` | dev | `0.1.0-dev` | automatico |
| `main` | test | `0.1.0-rc` | automatico |
| `v*` tags | prod | `0.1.0` | manual |

### Versionado

La version se lee del `package.json` raiz y se guarda como artifact de pipeline en el archivo `VERSION`. Los tags de Docker se componen como:

- **dev:** `$VERSION-dev` (ej: `0.1.0-dev`)
- **test:** `$VERSION-rc` (ej: `0.1.0-rc`)
- **prod:** `$VERSION` (ej: `0.1.0`)

### Registry

Las imagenes se pushean al GitLab Container Registry:

```
$CI_REGISTRY_IMAGE/<template>:<tag>
```

Por ejemplo: `registry.gitlab.com/mi-org/iskra/ecommerce-api:0.1.0-dev`

### Deploy

Los jobs de deploy son stubs que podes completar con tu herramienta:

```yaml
# kubectl
kubectl set image deployment/ecommerce ecommerce=$IMAGE:$TAG

# docker-compose
docker-compose pull && docker-compose up -d

# helm
helm upgrade iskra ./chart --set image.tag=$TAG
```

### Flujo de Trabajo

1. Pusheas a `develop` → se buildea y deploya a **dev** automaticamente
2. Merge a `main` → se buildea y deploya a **test** automaticamente
3. Creas un tag `v0.1.0` → se buildea, y el deploy a **prod** requiere aprobacion manual
