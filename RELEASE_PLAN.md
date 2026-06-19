# Iskra — Public Release Plan

> Goal: take Iskra from an internal monorepo to a credible public open-source project on **GitHub (primary) + Codeberg (mirror)**, with an **English-first / Spanish-secondary** documentation website built on **Starlight (Astro)**, shipping the incomplete kits (`desktop-kit`, `mobile-kit`, `db-oracle`) **clearly labeled as experimental**.

## Decisions (locked)

| Decision | Choice |
| :--- | :--- |
| Hosting | GitHub primary, Codeberg read-only mirror |
| Docs language | English primary, Spanish secondary (i18n) |
| Docs generator | Starlight (Astro) → static site on GitHub Pages |
| Incomplete kits | Ship as **experimental**, labeled in README/docs/package metadata |
| License | **AGPL-3.0-or-later** (confirmed — keep) |
| Publish strategy | **Compiled `dist/` build** (tsup/tsc → JS + .d.ts) for all consumers |
| npm scope | **Claim `@iskra-bun`** (verified free) and publish publicly |
| Docs domain | **GitHub Pages subdomain** (`<github-org>.github.io/iskra`) |
| Owning org | `<github-org>` — **TBD, fill in before Phase 3/7** |

## ⚠️ Pre-flight blockers (resolve before anything is public)

1. **Authorization** — ✅ confirmed: the author owns this repo and is authorizing the public release. (The former internal GitLab package-registry CI has been removed.)
2. **No git history currently** — the working dir is *not* a git repo. This is good: we start a **clean history** with no legacy secrets. Still run a working-tree secret scan.
3. **License finality** — AGPL-3.0 is strong copyleft; deters some adopters. Decide now (changing later is hard once forks exist).
4. **npm scope** — verify the `@iskra-bun` org is available on npm (or pick a scope). Needed for public package publish.
5. **Domain** — the Java SDK uses `dev.iskra` coordinates; check if `iskra.dev` is owned (drives docs custom domain).

---

## Phase 0 — Safety & foundation  (gate: clean tree under git)

- [x] Run a secret scan over the working tree (`gitleaks detect --no-git` / `trufflehog filesystem`). Remediate any hits. — gitleaks 8.30.1: 7 hits, all reviewed as test fixtures / dummy example keys; allowlisted via `.gitleaks.toml` → 0 leaks.
- [x] Audit for internal references to remove/parameterize: any internal Docker/npm registry, internal hostnames, `.env`-style values. — Only `registry.access.redhat.com` (public RH base image, keep) and stale GitLab doc examples in `docs/despliegue.md` (deferred to Phase 3 Task 6). No internal hostnames/secrets.
- [x] `git init`, craft a `.gitignore` (verify `node_modules`, `.env`, `storage/`, `dist`, `.claude/` excluded), make an initial clean commit on `main`. — commit `641ad60` on `main`, 477 files, tree clean.
- [ ] Decide & document branch strategy (trunk-based on `main`, PRs required).
- **Acceptance:** `gitleaks` clean; no internal hostnames in tracked files; repo initialized with one clean commit. ✅

## Phase 1 — Repo & build correctness  (gate: green local verify)

These are the audit's HIGH/MED build issues; they must be fixed or CI can never be green.

- [x] Add `"allowImportingTsExtensions": true` (+ `"noEmit": true`) to `tsconfig.base.json`; add a root `tsconfig.json` extending it. — both present; typecheck 0 errors.
- [x] Fix the **better-sqlite3 native-build failure**. — SQLite path already uses `@libsql/client`; no package declares or imports `better-sqlite3`. `bun install` completes clean (470 installs, exit 0). No version split remains.
- [x] Add root scripts: `typecheck` (`tsc --noEmit`), and make `lint` glob include `test/**`. — both present in root `package.json`.
- [x] Resolve the two known pre-existing tsc error sources (`core/src/otel.ts`, `web-kit` upload). — typecheck is 0 errors across `packages/*/src` + `test`.
- [ ] Decide package **publish strategy**: keep Bun-native `.ts` source (current) **or** add a `tsup`/`tsc` build to `dist/` for non-Bun npm consumers. (Recommended for public npm: build to `dist/` with `exports` map `import`/`types` → dist, so non-Bun users work.) — deferred (publish-time decision, Phase 5/7).
- **Acceptance:** `bun install` succeeds clean; `bun test` 0 fail; `bun run lint` 0 error; `bun run typecheck` 0 error. ✅ (394 pass / 33 skip / 0 fail)

## Phase 2 — Community health & metadata  (gate: project reads as "real OSS")

- [x] Rewrite root **`README.md` in English** (keep `README.es.md`): what/why, quick start, kit table, install, links to docs site, badges (CI, npm, license).
- [x] Add `CONTRIBUTING.md`, ~~`CODE_OF_CONDUCT.md` (Contributor Covenant)~~, `SECURITY.md` (disclosure policy + contact). — CoC **intentionally skipped** per maintainer decision (can be added later via GitHub's one-click Contributor Covenant).
- [ ] Add `CHANGELOG.md` (managed by Changesets — Phase 5).
- [x] Add `.github/`: issue templates (bug/feature), PR template, `FUNDING.yml` (optional), `CODEOWNERS`.
- [x] Add `.editorconfig`, `.nvmrc`/`.bun-version` (pin Bun), confirm `LICENSE` (AGPL) present at root and referenced in each package.
- [x] Per-package `package.json`: add `repository`, `homepage`, `bugs`, `keywords`, `author` fields. — all 10 packages complete.
- **Acceptance:** all community files present (CoC skipped by choice); `npm pkg` metadata complete on all 10 packages. ✅

## Phase 3 — CI/CD on GitHub Actions  (gate: PRs gated, release automated)

- [x] **`ci.yml`** (on PR + push): install → lint → typecheck → test. Service containers (redis:7/postgres:16/mysql:8) wired with creds matching the integration tests' default URLs so the 33 skips un-skip. Coverage via `bun test --coverage`. actionlint clean.
- [x] **Coverage gate**: `codecov.yml` + `codecov/codecov-action@v4`, ~70% target, `informational: true` (non-blocking first).
- [~] **`release.yml`** (on `v*` tag): npm publish public `@iskra-bun/*` with provenance + GitHub Release. **Prepared, pending Phase 5** (Changesets version-PR trigger + `dist/` build).
- [x] **`mirror.yml`** (on push to `main` + tags): force-push mirror to `codeberg.org/fearful/iskra` via `CODEBERG_DEPLOY_KEY`. (Read-only notice in Codeberg README is owner-operated at launch.)
- [x] **`docs.yml`**: build Starlight + lychee link-check + deploy to GitHub Pages. (Built in Phase 4.)
- [x] Delete `.gitlab-ci.yml`/`.gitlab-ci.desactivado.yml`; rewrite GitLab CI/CD section in `docs/despliegue.md` + `docs/README.md` as GitHub Actions (English README needed no change).
- **Acceptance:** workflows validate (actionlint clean); live-repo checks (real PR, npm publish, Codeberg push) are owner-operated post-launch — secrets `NPM_TOKEN`/`CODECOV_TOKEN`/`CODEBERG_DEPLOY_KEY` needed. Commit `0cf5b50`.

## Phase 4 — Documentation website (Starlight + i18n)  (gate: site builds & deploys)

- [x] Scaffold Astro + Starlight in `website/`. i18n: `en` (root/default) + `es`; `base: '/iskra'`; Pagefind + sitemap.
- [x] **Migrate** `docs/*.md` (Spanish) into `es/` + **translate** to `en/` (root). All 14 pages, code blocks byte-identical.
- [x] Author **Getting Started** (install → Web+DB API → run → test), **Concepts/Architecture**, **Templates gallery**, **Plugin/Driver authoring guide** — EN + ES.
- [x] **API reference**: TypeDoc over all 10 packages' `src/index.ts`, linked from the site (`/iskra/api/`).
- [x] Landing page (hero, feature grid, install snippet). Pagefind search enabled.
- [x] **Experimental** asides on `desktop-kit`/`mobile-kit`/`db-oracle` pages.
- [x] `docs.yml` deploys to GitHub Pages with a lychee link-check. (Custom domain deferred.)
- **Acceptance:** ✅ `bun run build` clean — 39 pages, Pagefind index (187 HTML), sitemap. EN+ES navigable. Live deploy is owner-operated (enable Pages → GitHub Actions). Commit `505a734`.

## Phase 5 — Versioning & experimental labeling  (gate: reproducible releases)

- [x] Adopt **Changesets**: `.changeset/config.json` (public, repo `fearful/iskra`, GitHub changelog, 22 apps/templates ignored). `release.yml` rewritten to the version-PR/publish flow; `version`/`release` root scripts added.
- [x] Compiled **`dist/` publish strategy**: per-package tsup build (ESM + `.d.ts`); dual-condition `exports` (`source`/`bun`→src for dev, `types`/`import`→dist for consumers). `npm publish --dry-run` on `@iskra-bun/core` ships `dist/` + `src` + CHANGELOG. All 10 packages at **0.1.0** with an initial `CHANGELOG.md`.
- [x] **`VERSIONING.md`** policy: semver + experimental kits (`desktop-kit`/`mobile-kit`/`db-oracle`) stay `0.x`, breaking changes allowed in minor.
- **Acceptance:** ✅ `bun run build` deterministic (3/3, all 10 dist). `changeset version` verified: core 0.1.0→0.1.1 (patch), web-kit→0.2.0 (minor), CHANGELOGs written, internal-dep cascade correct. typecheck/test/lint stay green (394 pass/33 skip/0 fail). Commit `e23e665`. (Live `changeset publish` is owner-operated — needs `NPM_TOKEN`.)

## Phase 6 — SDK & test polish  (can partly trail launch)

- [ ] Add unit tests to the **Java** and **Python** SDKs (both currently have zero). Mark them `beta` if thin.
- [ ] Java: add `distributionManagement` for Maven Central (or hold and document as source-only).
- [ ] Add **smoke tests** for the 5 expanded templates (chat-app, job-worker, cms-starter, desktop-app, universal-app) — boot + hit an endpoint.
- [ ] Document Go/.NET SDKs as **roadmap** (not present).
- **Acceptance:** SDK test suites run in CI; template smoke tests pass.

## Phase 7 — Launch  (gate: public)

- [ ] Final pass: README badges resolve, docs links valid, `npm publish --dry-run` clean, license headers consistent.
- [ ] Flip GitHub repo to **public**; push Codeberg mirror.
- [ ] Tag `v0.1.0` → release workflow publishes npm packages + GitHub Release; docs site live.
- [ ] Announce (README, optionally HN/Reddit/Bun Discord/Lobsters). Add `good first issue`s to invite contributors.
- **Acceptance:** packages installable from a clean machine (`bun add @iskra-bun/core`), docs site reachable, CI green on `main`.

---

## Sequencing & dependencies

```
Phase 0 (safety) ─▶ Phase 1 (build green) ─▶ Phase 3 (CI)
                          │                       │
                          ├─▶ Phase 2 (health) ───┤
                          └─▶ Phase 4 (docs site) ─┴─▶ Phase 5 (versioning) ─▶ Phase 7 (LAUNCH)
                                                          Phase 6 (SDK/tests) ──┘ (parallel, can trail)
```

- **Critical path:** 0 → 1 → 3 → 5 → 7. Docs (4) and health (2) run in parallel after Phase 1. Phase 6 can slip past launch.
- Each phase is sized for one `/orchestrate` run; I can generate a per-phase `prompt_plan.md` when you're ready to execute that phase.

## Rough effort (relative)

| Phase | Effort | Notes |
| :--- | :--- | :--- |
| 0 Safety | S | mostly scanning + git init |
| 1 Build correctness | M | sqlite migration is the variable |
| 2 Community health | S–M | mostly writing |
| 3 CI/CD | M | service containers + release automation |
| 4 Docs site | **L** | translation is the bulk |
| 5 Versioning | S | Changesets setup |
| 6 SDK/tests | M | optional pre-launch |
| 7 Launch | S | checklist |

## Open questions — status

- ✅ License → **AGPL-3.0-or-later** (keep)
- ✅ npm `@iskra-bun` scope → **free, claim it**
- ✅ Docs domain → **GitHub Pages subdomain** (custom domain deferred)
- ✅ Publish strategy → **compiled `dist/`**
- ⬜ **GitHub org/account that will own the repo** — still needed (placeholder `<github-org>` used in phase plans)

## Execution artifacts

Per-phase `/orchestrate`-ready task lists live in [`plans/`](plans/). To run a phase:
`cp plans/phase-N-*.md prompt_plan.md` then `/orchestrate`.
