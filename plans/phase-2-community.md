# Prompt Plan — Phase 2: Community Health & Metadata

> Goal: the repo reads as a real, contributable open-source project. English-first docs entry, standard community files, complete package metadata.
> Type: `--type feature`. License: AGPL-3.0-or-later. Owning org: `<github-org>` (fill in).

## Domain & Commands

| Action | Command |
| :--- | :--- |
| Lint | `bun run lint` |
| Test | `bun test` |

## Tasks

- [ ] Task 1: Rewrite root `README.md` in **English** (what/why, quick start, kit table, install via `bun add @iskra-bun/*`, links to docs site + Codeberg mirror, badges: CI, npm, license, made-with-Bun). Move the current Spanish README to `README.es.md` and cross-link both. Owns: `README.md`, `README.es.md`. 
- [ ] Task 2: Add `CONTRIBUTING.md` (dev setup, Bun version, test/lint/typecheck commands, PR + Changesets flow, conventional commits). Owns: `CONTRIBUTING.md`. 
- [ ] Task 3: Add `CODE_OF_CONDUCT.md` (Contributor Covenant v2.1) and `SECURITY.md` (supported versions, private disclosure contact, response SLA). Owns: `CODE_OF_CONDUCT.md`, `SECURITY.md`. 
- [ ] Task 4: Add `.github/`: ISSUE_TEMPLATE (bug_report.yml, feature_request.yml, config.yml), PULL_REQUEST_TEMPLATE.md, CODEOWNERS, optional FUNDING.yml. Owns: `.github/**` (excluding workflows — those are Phase 3). 
- [ ] Task 5: Add `.editorconfig` (match `.prettierrc`: 4-space, LF, utf-8, final newline) and pin Bun via `.bun-version` (and `.nvmrc` for Node fallback). Owns: `.editorconfig`, `.bun-version`, `.nvmrc`. 
- [ ] Task 6: Complete per-package `package.json` metadata on all 10 packages: add `repository` (directory pointing to `packages/<name>`), `homepage`, `bugs`, `keywords`, `author`. For `desktop-kit`/`mobile-kit`/`db-oracle` add an `"experimental"` keyword. Owns: `packages/*/package.json`. (depends: none)

## Acceptance

- English README renders with working links/badges; Spanish preserved at `README.es.md`.
- CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, and `.github/` templates present.
- All 10 packages have complete metadata; experimental kits flagged.
- `bun test` 0 fail; `bun run lint` 0 error.
