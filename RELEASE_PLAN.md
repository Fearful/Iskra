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

- [ ] Run a secret scan over the working tree (`gitleaks detect --no-git` / `trufflehog filesystem`). Remediate any hits.
- [ ] Audit for internal references to remove/parameterize: any internal Docker/npm registry, internal hostnames, `.env`-style values. (Former internal GitLab registry CI already removed.)
- [ ] `git init`, craft a `.gitignore` (verify `node_modules`, `.env`, `storage/`, `dist`, `.claude/` excluded), make an initial clean commit on `main`.
- [ ] Decide & document branch strategy (trunk-based on `main`, PRs required).
- **Acceptance:** `gitleaks` clean; no internal hostnames in tracked files; repo initialized with one clean commit.

## Phase 1 — Repo & build correctness  (gate: green local verify)

These are the audit's HIGH/MED build issues; they must be fixed or CI can never be green.

- [ ] Add `"allowImportingTsExtensions": true` (+ `"noEmit": true`) to `tsconfig.base.json`; add a root `tsconfig.json` extending it. Resolves ~75–93 TS5097 errors.
- [ ] Fix the **better-sqlite3 native-build failure**: prefer migrating `db-kit`'s SQLite path to **`bun:sqlite`** (native, no node-gyp) or `node:sqlite`; otherwise pin a prebuilt-binary version and document the toolchain. Align the `^9.4.3` (db-kit) vs `^12.6.2` (templates) split.
- [ ] Add root scripts: `typecheck` (`tsc --noEmit`), and make `lint` glob include `test/**` (currently `src/**` only).
- [ ] Resolve the two known pre-existing tsc error sources: `packages/core/src/otel.ts` (guard optional `@opentelemetry/*`), `packages/web-kit` upload module-resolution.
- [ ] Decide package **publish strategy**: keep Bun-native `.ts` source (current) **or** add a `tsup`/`tsc` build to `dist/` for non-Bun npm consumers. (Recommended for public npm: build to `dist/` with `exports` map `import`/`types` → dist, so non-Bun users work.)
- **Acceptance:** `bun install` succeeds clean; `bun test` 0 fail; `bun run lint` 0 error; `bun run typecheck` 0 error.

## Phase 2 — Community health & metadata  (gate: project reads as "real OSS")

- [ ] Rewrite root **`README.md` in English** (keep `README.es.md`): what/why, quick start, kit table, install, links to docs site, badges (CI, npm, license).
- [ ] Add `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` (Contributor Covenant), `SECURITY.md` (disclosure policy + contact).
- [ ] Add `CHANGELOG.md` (managed by Changesets — Phase 5).
- [ ] Add `.github/`: issue templates (bug/feature), PR template, `FUNDING.yml` (optional), `CODEOWNERS`.
- [ ] Add `.editorconfig`, `.nvmrc`/`.bun-version` (pin Bun), confirm `LICENSE` (AGPL) present at root and referenced in each package.
- [ ] Per-package `package.json`: add `repository`, `homepage`, `bugs`, `keywords`, `author` fields (currently missing). Mark experimental kits with a clear note + `"experimental"` keyword.
- **Acceptance:** all community files present; `npm pkg` metadata complete on all 10 packages.

## Phase 3 — CI/CD on GitHub Actions  (gate: PRs gated, release automated)

- [ ] **`ci.yml`** (on PR + push): matrix on Bun; steps = install → lint → typecheck → test. Spin up service containers (Redis, Postgres, MySQL) so the 33 skipped integration tests actually run. Upload coverage (`bun test --coverage`).
- [ ] **Coverage gate**: report via Codecov/Coveralls; set a threshold (start ~70%, ratchet up).
- [ ] **`release.yml`** (on Changesets version PR merge / tag): build, publish public packages to npm with provenance, create GitHub Release with generated notes.
- [ ] **`mirror.yml`** (on push to `main` + tags): force-push mirror to Codeberg (`codeberg.org/<org>/iskra`) via deploy key. Mark the Codeberg repo read-only in its README.
- [ ] **`docs.yml`** (Phase 4): build Starlight, deploy to GitHub Pages.
- [x] Delete `.gitlab-ci.yml` and `.gitlab-ci.desactivado.yml` (done). Remaining: rewrite the stale GitLab CI/CD section in `docs/despliegue.md` + README rows (handled in Phase 3 Task 6).
- **Acceptance:** a test PR shows all checks running & required; a dry-run tag produces a draft release; Codeberg mirror updates.

## Phase 4 — Documentation website (Starlight + i18n)  (gate: site builds & deploys)

- [ ] Scaffold Astro + Starlight in `website/` (or `docs-site/`). Configure i18n: `en` (root/default) + `es`.
- [ ] **Migrate** existing `docs/*.md` (Spanish) into `src/content/docs/es/`; **translate** each to `en/`. Map: arquitectura, core, web-kit, db-kit, socket-kit, kv-kit, worker-kit, process-kit, desktop-kit, mobile-kit, configuracion, migraciones, despliegue, sdks.
- [ ] Author the **missing HIGH-priority docs**: a true end-to-end **Getting Started** tutorial (build + run a real API), a **Concepts/Architecture** page (hexagonal, drivers/plugins, lifecycle), a **Templates gallery**, and a **Plugin/Driver authoring guide**.
- [ ] **API reference**: generate with TypeDoc from package sources, embed/link from the site.
- [ ] Landing page (hero, feature grid, install snippet, links). Built-in Pagefind search. Versioned-docs strategy noted for later.
- [ ] Clearly badge `desktop-kit`/`mobile-kit`/`db-oracle` pages as **Experimental**.
- [ ] Deploy via `docs.yml` to GitHub Pages; optional custom domain (`iskra.dev` / `docs.iskra.dev`) if owned, else `*.github.io`.
- **Acceptance:** site builds with 0 broken links (link-check in CI), EN + ES both navigable, search works, deployed URL live.

## Phase 5 — Versioning & experimental labeling  (gate: reproducible releases)

- [ ] Adopt **Changesets** for the monorepo: contributor changesets → version PR → changelog per package.
- [ ] Set the initial public version (recommend **0.1.0** across packages, or `0.0.x` for experimental kits) and a documented **semver + experimental** policy.
- [ ] Ensure experimental kits are versioned `0.x` and flagged so semver expectations are clear.
- **Acceptance:** `changeset version` produces correct bumps + CHANGELOG; release workflow consumes it.

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
