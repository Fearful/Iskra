---
title: Deployment
description: Guide for building Docker images and understanding the CI/CD pipeline in GitHub Actions.
---

Guide for building Docker images and understanding the CI/CD pipeline in GitHub Actions.

## Docker

Each template includes a `Dockerfile` that uses multi-stage builds, built from the
repository root (the root `.dockerignore` limits the context to the workspace):

1. **Build:** `oven/bun`, at the version in `.bun-version`, runs
   `bun install --frozen-lockfile` over the whole workspace (the lockfile covers every
   workspace, so copying only some of them fails) and compiles a standalone binary with
   `bun build --compile`.
2. **Runtime:** Red Hat's `ubi9/ubi-minimal`. The binary only needs glibc, so this
   stage installs nothing (it builds offline or behind a TLS-inspecting proxy) and runs
   as a non-root UID in group 0.

:::caution[`NODE_ENV` is fixed at build time]
`bun build` inlines `process.env.NODE_ENV` (`"development"` unless it is set while
building), so a compiled binary ignores the runtime value. Build with
`NODE_ENV=production`, as the template Dockerfiles do: otherwise the app runs in
development mode in production (stack traces in error responses, session cookies
without `Secure`).
:::

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

### `release.yml` — Publishing (with Changesets)

Runs on every **push to `main`** and uses [Changesets](https://github.com/changesets/changesets).
It does one of two things:

1. If there are **pending changesets**, it opens/updates a **"Version Packages"**
   PR that consumes them: it bumps each affected `@iskra-bun/*` package, updates
   its `CHANGELOG.md`, and deletes the changesets. Merging that PR is the human
   "cut a release" gate.
2. If there are **no pending changesets** (i.e. the version PR was just merged),
   it runs the `release` script: it builds every package to `dist/` and then
   `changeset publish` publishes the public packages to npm with provenance, and
   creates the matching **GitHub Releases**.

Versions and changelogs are never hand-edited; they flow from the changeset files
contributors add (see `CONTRIBUTING.md` / `VERSIONING.md`).

Each package publishes a compiled `dist/` (ESM JS + `.d.ts`, built with tsup); the
`exports` map resolves to `dist/` for npm/Node consumers and to `src/` (via a
`source`/`bun` condition) for Bun development with no build step.

It requires the `NPM_TOKEN` secret (publish) and uses the automatic `GITHUB_TOKEN`
for the version PR and Releases. The `id-token: write` permission enables npm
provenance.

### `mirror.yml` — Mirror on Codeberg

On every push to `main` and every tag, it runs a `git push --mirror --force` to
`codeberg.org/fearful/iskra`. It requires the `CODEBERG_DEPLOY_KEY` secret (private
SSH key whose public part is loaded as a Deploy Key with write access to the
Codeberg repo).

### Workflow

1. You open a PR (with a changeset) → `ci.yml` runs (lint, typecheck, tests with
   services, coverage).
2. Merge to `main` → `ci.yml`, `mirror.yml` (updates the Codeberg mirror) and
   `release.yml` run (opens the **"Version Packages"** PR if changesets are pending).
3. You merge the "Version Packages" PR → `release.yml` builds and publishes to npm
   + creates the GitHub Releases; `mirror.yml` mirrors the changes.
