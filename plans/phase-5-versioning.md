# Prompt Plan — Phase 5: Versioning & Release Management (Changesets)

> Goal: reproducible, automated monorepo versioning + changelogs, with a clear semver/experimental policy. Also implements the compiled-`dist/` publish strategy.
> Type: `--type feature`. Prereq: Phase 1 green; coordinates with Phase 3 release.yml.

## Domain & Commands

| Action | Command |
| :--- | :--- |
| Version | `bunx changeset version` |
| Build | `bun run build` (per-package tsup/tsc) |

## Tasks

- [ ] Task 1: Add a per-package **build** to compiled `dist/` (tsup or tsc): emit JS + `.d.ts`, and update each `package.json` `main`/`module`/`types`/`exports` to point at `dist/` (with a dev condition still resolving `src/` for Bun workspace use). Add root `"build"` script that builds all packages. Owns: `packages/*/package.json`, `packages/*/tsup.config.ts` (or shared), root `package.json` build script. 
- [ ] Task 2: Install and configure **Changesets** (`.changeset/config.json`): scope to `@iskra-bun/*`, public access, `main` baseBranch, link to repo. Add a CONTRIBUTING note on writing changesets. Owns: `.changeset/**`. (depends: none)
- [ ] Task 3: Write a `VERSIONING.md` policy: semver rules, that `desktop-kit`/`mobile-kit`/`db-oracle` stay `0.x` experimental (breaking changes allowed in minor), and the release flow. Owns: `VERSIONING.md`. 
- [ ] Task 4: Create the initial changeset(s) setting all public packages to `0.1.0` and generate `CHANGELOG.md` files via `changeset version`. Owns: `.changeset/*.md`, generated `CHANGELOG.md` per package. (depends: Task 2)
- [ ] Task 5: Verify the release path end-to-end with `npm publish --dry-run` against the built `dist/` for one package (e.g. `@iskra-bun/core`); confirm `release.yml` (Phase 3) consumes Changesets correctly. Report evidence. (depends: Task 1, Task 4)

## Acceptance

- `bun run build` produces `dist/` (JS + .d.ts) for every package; `exports` resolve for non-Bun consumers.
- `bunx changeset version` bumps correctly and writes CHANGELOGs.
- `npm publish --dry-run` is clean for a sample package.
