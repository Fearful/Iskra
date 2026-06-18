# Prompt Plan — Phase 1.5: Green Typecheck & Lint

> Goal: get `bun run typecheck` and `bun run lint` to exit 0, so Phase 3 CI can gate on them. Phase 1 took typecheck 331 → 215; this finishes the job.
> Type: `--type bugfix`. Domain: Bun + TypeScript monorepo. Prereq: Phase 1 done.

## Domain & Commands

| Action | Command |
| :--- | :--- |
| Typecheck | `bun run typecheck` |
| Lint | `bun run lint` |
| Test | `bun test` |

## Tasks

- [ ] Task 1: Scope the root typecheck to the libraries. The root `tsc --noEmit` currently walks `templates/forms-app` React `.tsx` files (≈200 TS17004/TS6142 JSX errors) which have their OWN per-service tsconfigs. Fix by scoping the root `tsconfig.json`/`typecheck` script to `packages/` (and excluding templates that carry their own tsconfig), OR add the needed `jsx`/exclude settings. Verify the ≈200 forms-app JSX errors disappear from `bun run typecheck`. Owns: `tsconfig.json`, root `package.json` (typecheck script). 
- [ ] Task 2: Fix real package typing errors surfaced by typecheck: `packages/db-kit/src/cli.ts` TS1375 (`await` at top level — add `export {}` or proper module form), `packages/core/test/events.test.ts` tuple typing (TS2493/TS2532), and `packages/db-kit/test/driver.test.ts` overload (TS2769). Owns: those 3 files. (depends: Task 1)
- [ ] Task 3: Fix web-kit typing drift: `packages/web-kit/examples/*` reference renamed/old exports (`requireAnyScope`→`requireScope`, `DbConfig.config`, untyped `c`), and `packages/web-kit/src/features/email/providers/mailgun.ts` TS2322 (Uint8Array→BlobPart, same fix pattern as the upload feature). Either fix or exclude `examples/` from typecheck — decide and document. Owns: `packages/web-kit/examples/**`, `packages/web-kit/src/features/email/providers/mailgun.ts`. (depends: Task 1)
- [ ] Task 4: Triage and fix the 26 lint ERRORS (ban-ts-comment ×12, no-empty ×5, prefer-const ×3, no-case-declarations ×3, no-require-imports ×3) across packages. Leave warnings for a later pass unless trivial. Owns: the specific source/test files flagged by `bun run lint` (coordinate to avoid overlap with Tasks 2/3). (depends: none)
- [ ] Task 5: Verify — `bun run typecheck` exit 0, `bun run lint` exit 0 (or 0 errors), `bun test` 0 fail. Report evidence. (depends: Task 1, Task 2, Task 3, Task 4)

## Acceptance

- `bun run typecheck` → 0 errors.
- `bun run lint` → 0 errors.
- `bun test` → 0 fail (unchanged 394 pass).
