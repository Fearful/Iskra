# Versioning & Release Policy

Iskra uses [Changesets](https://github.com/changesets/changesets) to version and
publish the `@iskra-bun/*` packages. This document describes the rules so that
version numbers mean something predictable.

## Semantic Versioning

All published packages follow [SemVer](https://semver.org/) (`MAJOR.MINOR.PATCH`):

- **PATCH** (`0.1.0 → 0.1.1`) — backwards-compatible bug fixes.
- **MINOR** (`0.1.0 → 0.2.0`) — backwards-compatible new features.
- **MAJOR** (`0.1.0 → 1.0.0`) — breaking changes to the public API.

While the project is pre-1.0, the public API may still move; we use the
experimental policy below to set expectations per package.

## Stable vs. Experimental packages

| Tier | Packages | Stability |
| :--- | :--- | :--- |
| **Stable** | `core`, `web-kit`, `db-kit`, `kv-kit`, `socket-kit`, `worker-kit`, `process-kit` | SemVer applies normally. Breaking changes bump MAJOR (once 1.0) or MINOR (while 0.x). |
| **Experimental** | `desktop-kit`, `mobile-kit`, `db-oracle` | Stay on `0.x` indefinitely. **Breaking changes may ship in a MINOR bump.** APIs are not yet stable; pin an exact version if you depend on them. |

Experimental packages carry an `"experimental"` keyword in their `package.json`
and an **Experimental** callout in their docs.

## How a release happens

1. **Contributors add a changeset** with their PR:
   ```bash
   bunx changeset
   ```
   Pick the affected packages and a bump type (patch/minor/major), and write a
   one-line summary. This creates a markdown file under `.changeset/`. See
   [CONTRIBUTING.md](CONTRIBUTING.md).

2. **Merging to `main`** triggers the release workflow
   ([`.github/workflows/release.yml`](.github/workflows/release.yml)), which
   opens a **"Version Packages"** PR. That PR consumes the pending changesets:
   it bumps each affected package's version, updates its `CHANGELOG.md`, and
   deletes the changeset files.

3. **Merging the "Version Packages" PR** triggers the workflow again — this time
   with no pending changesets — so it **builds every package to `dist/` and
   publishes** the changed public packages to npm with provenance, then creates
   the matching GitHub Releases.

Versions and changelogs are therefore never edited by hand; they are derived
from changeset files.

## Internal dependencies

Packages depend on each other via `workspace:*`. When a package bumps, Changesets
bumps the recorded dependency range of its dependents by a **patch** by default
(`updateInternalDependencies: "patch"` in `.changeset/config.json`).

## What gets published

Only the packages under `packages/` are published (`access: "public"`). The
example apps and templates are marked `"private": true` — which is what makes
`changeset publish` skip them — and are also listed in `.changeset/config.json`'s
`ignore` array so they are never versioned.

Each published package ships a compiled `dist/` (ESM JS + `.d.ts`, built with
[tsup](https://tsup.egoist.dev/)). The `exports` map resolves to `dist/` for
npm/Node consumers, while a `source`/`bun` condition points back at `src/` so
Bun workspace development and type-checking need no build step.
