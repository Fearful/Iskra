# Prompt Plan — Phase 3: CI/CD (GitHub Actions)

> Goal: PRs are gated by lint+typecheck+test (incl. integration tests via service containers), releases publish to npm automatically, and a Codeberg mirror stays in sync.
> Type: `--type feature`. Owning org: `<github-org>` (fill in). Prereq: Phase 1 green.

## Domain & Commands

| Action | Command |
| :--- | :--- |
| Test | `bun test` |
| Coverage | `bun test --coverage` |

## Tasks

- [ ] Task 1: Add `.github/workflows/ci.yml` — on PR + push to `main`. Steps: checkout, setup-bun, `bun install --frozen-lockfile`, `bun run lint`, `bun run typecheck`, `bun test --coverage`. Add service containers (redis:7, postgres:16, mysql:8) and set `TEST_REDIS_URL`/`TEST_PG_URL`/`TEST_MYSQL_URL` so the ~33 skipped integration tests actually run. Owns: `.github/workflows/ci.yml`. 
- [ ] Task 2: Wire coverage upload (Codecov or Coveralls) and a coverage summary in the PR. Set an initial threshold (~70%, non-blocking comment first, then enforce). Owns: `.github/workflows/ci.yml` (coverage step), `codecov.yml`. (depends: Task 1)
- [ ] Task 3: Add `.github/workflows/release.yml` — triggered by Changesets version-PR merge (or `v*` tag). Build (`dist/` per Phase 5 strategy), `bun run` build, publish public packages to npm with provenance (`npm publish --provenance --access public`), and create a GitHub Release with generated notes. Use `NPM_TOKEN` secret. Owns: `.github/workflows/release.yml`. (depends: none — coordinate with Phase 5 Changesets)
- [ ] Task 4: Add `.github/workflows/mirror.yml` — on push to `main` + tags, force-push a mirror to `codeberg.org/<github-org>/iskra` using a `CODEBERG_DEPLOY_KEY` secret. Owns: `.github/workflows/mirror.yml`. 
- [ ] Task 5: Add a placeholder `.github/workflows/docs.yml` (build + deploy Starlight to GitHub Pages) to be completed in Phase 4. Owns: `.github/workflows/docs.yml`. 
- [ ] Task 6: Finish the GitLab→GitHub migration. (The `.gitlab-ci.yml`/`.gitlab-ci.desactivado.yml` files are already deleted.) Rewrite the GitLab CI/CD section of `docs/despliegue.md` to describe the new GitHub Actions pipeline, and fix the "CI/CD con GitLab" rows in `README.md` and `docs/README.md`. Owns: `docs/despliegue.md`, `README.md`, `docs/README.md`. (depends: Task 1, Task 3)

## Acceptance

- A test PR shows ci.yml running lint+typecheck+test+coverage, integration tests no longer skipped.
- `release.yml` passes `npm publish --dry-run`; a tag produces a draft GitHub Release.
- Codeberg mirror receives a push.
- GitLab CI no longer active.

## Secrets to configure (manual, by repo owner)

`NPM_TOKEN`, `CODEBERG_DEPLOY_KEY`, `CODECOV_TOKEN` (if private).
