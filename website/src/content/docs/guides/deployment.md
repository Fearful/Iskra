---
title: Deployment
description: Guide for building Docker images and understanding the CI/CD pipeline in GitHub Actions.
---

Guide for building Docker images and understanding the CI/CD pipeline in GitHub Actions.

## Docker

Each template includes a `Dockerfile` that uses multi-stage builds:

1. **Stage 1 (Builder):** Uses `oven/bun:1` to install dependencies and compile to a standalone binary with `bun build --compile`.
2. **Stage 2 (Runtime):** Uses Red Hat's `ubi9/ubi-minimal` as a minimal production image.

### Build an Image

From the root of the monorepo:

```bash
# Ecommerce API
docker build -f templates/ecommerce-api/Dockerfile -t iskra-ecommerce:latest .

# Job Worker
docker build -f templates/job-worker/Dockerfile -t iskra-worker:latest .

# Realtime Feed
docker build -f templates/realtime-feed/Dockerfile -t iskra-realtime:latest .
```

### Run a Container

```bash
docker run -p 3000:3000 \
    -e PORT=3000 \
    -e DATABASE_URL=app.db \
    iskra-ecommerce:latest
```

### Dockerfile.base

If you need to create a Dockerfile for a new template, you can use `Dockerfile.base` as a reference. It accepts `ARG TEMPLATE_NAME` and `ARG ENTRY_POINT`.

## CI/CD with GitHub Actions

The pipeline lives in `.github/workflows/` and is composed of three independent
workflows: `ci.yml`, `release.yml` and `mirror.yml`.

### `ci.yml` — Continuous Integration

Runs on every **pull request** and every **push to `main`**. Steps:

```
checkout → setup-bun → bun install --frozen-lockfile → lint → typecheck → test --coverage → upload coverage
```

So that the integration tests (Redis, Postgres and MySQL) stop being skipped,
the job spins up **service containers** and exposes the environment variables that
those tests read to detect available services:

| Service | Image | Environment variable |
|----------|--------|---------------------|
| Redis | `redis:7` | `TEST_REDIS_URL=redis://127.0.0.1:6379` |
| Postgres | `postgres:16` | `TEST_PG_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres` |
| MySQL | `mysql:8` | `TEST_MYSQL_URL=mysql://root:mysql@127.0.0.1:3306/test` |

The credentials match exactly the default values of the test files, so the gated
`describe()` blocks are activated in CI.

Coverage is uploaded to [Codecov](https://codecov.io) with
`codecov/codecov-action`. It is **informational** for now (initial target ~70%,
configured in `codecov.yml` with `informational: true`), so it does not block the
merge. It requires the `CODECOV_TOKEN` secret.

### `release.yml` — Publishing

Triggered when pushing a `v*` tag (e.g.: `v0.1.0`). Steps:

1. Build of the packages (runs the `build` script of each package if it exists).
2. `npm publish --provenance --access public` for each **public** `@iskra-bun/*`
   package. Packages marked `private` are skipped.
3. Creates a **GitHub Release** with automatically generated notes.

> **Note (Phase 5):** the integration with Changesets (the "version PR" that bumps
> versions and changelogs, and whose merge generates the tag) is finalized in Phase 5.
> The build-to-`dist/` strategy is also defined in Phase 5; for now the packages
> publish their source TypeScript code directly.

It requires the `NPM_TOKEN` secret (publish) and uses the automatic `GITHUB_TOKEN`
for the Release. The `id-token: write` permission enables npm provenance.

### `mirror.yml` — Mirror on Codeberg

On every push to `main` and every tag, it runs a `git push --mirror --force` to
`codeberg.org/fearful/iskra`. It requires the `CODEBERG_DEPLOY_KEY` secret (private
SSH key whose public part is loaded as a Deploy Key with write access to the
Codeberg repo).

### Workflow

1. You open a PR → `ci.yml` runs (lint, typecheck, tests with services, coverage).
2. Merge to `main` → `ci.yml` and `mirror.yml` run (updates the mirror on Codeberg).
3. You create a `v0.1.0` tag → `release.yml` runs (publishes to npm + GitHub Release) and
   `mirror.yml` (mirrors the tag).
