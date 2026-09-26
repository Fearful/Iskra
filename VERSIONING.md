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
   the matching GitHub Releases. The build runs in a job of its own with no
   secrets; the `publish` job, in the `npm` environment, only runs the
   Changesets CLI on the built packages, so no build tool or dependency install
   script runs next to the npm credentials.

Versions and changelogs are therefore never edited by hand; they are derived
from changeset files.

## Internal dependencies

Packages depend on each other via `workspace:^`, which the release
(`scripts/pin-workspace-deps.ts`) publishes as `^<version>`: a caret range lets
an app with several kits share one copy of `@iskra-bun/core` instead of one
exact version per kit. A dependent is re-released only when a bump leaves the
caret range it publishes (on 0.x, a minor bump of the dependency); its range
is then raised by a **patch** release (`updateInternalDependencies: "patch"` in
`.changeset/config.json`).

## What gets published

Only the packages under `packages/` are published (`access: "public"`). The
example apps and templates are marked `"private": true` — which is what makes
`changeset publish` skip them — and are also listed in `.changeset/config.json`'s
`ignore` array so they are never versioned.

Each published package ships a compiled `dist/` (ESM JS + `.d.ts`, built with
[tsup](https://tsup.egoist.dev/)). The `exports` map resolves to `dist/` for
npm/Node consumers, while a `source`/`bun` condition points back at `src/` so
Bun workspace development and type-checking need no build step.

## Provenance and trusted publishing

Every package sets `publishConfig.provenance: true`, so npm attaches a
[provenance attestation](https://docs.npmjs.com/generating-provenance-statements)
that links each published version to the commit and the `release.yml` run that
built it. npm only issues it from a supported CI provider, so a publish from a
laptop fails instead of shipping an unattested version (pass `--no-provenance`
if you ever must publish by hand).

The workflow authenticates with a long-lived `NPM_TOKEN` secret until
[trusted publishing](https://docs.npmjs.com/trusted-publishers) is configured;
after that, npm exchanges the job's OIDC token and no npm secret exists at all:

1. On npmjs.com, open each package's **Settings → Trusted publishing** and add a
   GitHub Actions publisher: organization/user `fearful`, repository `iskra`,
   workflow filename `release.yml`, environment `npm`. Only the workflow's
   `publish` job runs in that environment, so no other job can mint a publish
   token.
2. Run a release to confirm it publishes, then delete the `NPM_TOKEN` secret
   (and revoke the token on npmjs.com).

In the repository settings, the `npm` environment (created by the first run)
can require an approval before each publish; until trusted publishing is
configured, store `NPM_TOKEN` as a secret of that environment rather than of
the repository.

To check a published version, `npm view <package>@<version> dist.attestations`
lists its attestations, and `npm audit signatures` in a project that depends on
it verifies the signatures of everything installed.
