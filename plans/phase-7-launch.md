# Prompt Plan — Phase 7: Launch

> Goal: flip Iskra public, publish v0.1.0 to npm, mirror to Codeberg, announce. Final gate.
> Type: `--type feature`. Prereq: Phases 0–5 done (6 may trail). Owning org: `<github-org>`.

## ⚠️ Mostly owner-operated

Several steps require the repo owner's accounts/credentials (npm, GitHub org, Codeberg). The team prepares + verifies; the owner flips switches.

## Tasks

- [ ] Task 1: Final pre-flight pass — verify all README badges resolve, all docs-site links valid (lychee), `npm publish --dry-run` clean for every public package, license headers consistent, no `<github-org>` placeholders left unfilled anywhere. Produce a go/no-go checklist with evidence. Owns: report + small fixes. 
- [ ] Task 2: Create the GitHub repo under `<github-org>/iskra`, push `main`, configure: branch protection on `main` (require CI), enable Pages, add required secrets (`NPM_TOKEN`, `CODEBERG_DEPLOY_KEY`, `CODECOV_TOKEN`). [owner-operated] (depends: Task 1)
- [ ] Task 3: Create the Codeberg repo `<github-org>/iskra`, verify the `mirror.yml` push lands, mark it read-only (mirror notice in its README). [owner-operated] (depends: Task 2)
- [ ] Task 4: Tag `v0.1.0` → confirm `release.yml` builds `dist/`, publishes all public `@iskra-bun/*` packages to npm with provenance, and creates the GitHub Release. Verify `bun add @iskra-bun/core` works from a clean machine. (depends: Task 2)
- [ ] Task 5: Flip the GitHub repo to **public**; confirm the docs site is live at the Pages URL. (depends: Task 4)
- [ ] Task 6: Announce — finalize README, seed a few `good first issue`s, optional posts (Bun Discord, Lobsters, HN, r/programming). Owns: a short `ANNOUNCE.md` draft. (depends: Task 5)

## Acceptance

- Packages installable from a clean machine (`bun add @iskra-bun/core`).
- Docs site reachable; CI green on `main`; Codeberg mirror in sync.
- v0.1.0 GitHub Release published; repo public.
