# Prompt Plan — Phase 1: Build & Repo Correctness

> Goal: a fully green local verification — `bun install` clean, tests pass, lint clean, typecheck clean. Fixes the audit's HIGH/MED build blockers so CI can ever go green.
> Type: `--type bugfix`. Domain: Bun + TypeScript monorepo.

## Domain & Commands

| Action | Command |
| :--- | :--- |
| Install | `bun install` |
| Test | `bun test` |
| Lint | `bun run lint` |
| Typecheck | `bunx tsc --noEmit -p tsconfig.base.json` |

## Tasks

- [ ] Task 1: Add `"allowImportingTsExtensions": true` and `"noEmit": true` to `tsconfig.base.json`; create a root `tsconfig.json` that extends it and references packages/templates. Verify the ~75–93 TS5097 `.ts`-import errors disappear. Owns: `tsconfig.base.json`, `tsconfig.json`. 
- [ ] Task 2: Fix the better-sqlite3 native-build failure. Preferred: migrate `@iskra-bun/db-kit`'s SQLite driver path to Bun-native `bun:sqlite` (no node-gyp); if Drizzle requires better-sqlite3, pin a version with prebuilt binaries and document the toolchain. Owns: `packages/db-kit/**`. (depends: none)
- [ ] Task 3: Align `better-sqlite3` versions across the repo (db-kit `^9.4.3` vs templates `^12.6.2`) to a single supported range consistent with Task 2. Owns: `templates/*/package.json` (sqlite-using ones). (depends: Task 2)
- [ ] Task 4: Add root `package.json` scripts: `"typecheck": "tsc --noEmit"`, and widen the `lint`/`format` globs to include `**/test/**/*.ts` (currently `src/**` only). Owns: root `package.json`, `eslint.config.mjs` (if ignore tweak needed). 
- [ ] Task 5: Guard the optional OpenTelemetry deps in `packages/core/src/otel.ts` so tsc/runtime don't error when `@opentelemetry/*` is absent. Owns: `packages/core/src/otel.ts` (+ test). (depends: none)
- [ ] Task 6: Fix the `packages/web-kit` upload-feature module-resolution tsc error. Owns: `packages/web-kit/src/features/upload/**`. (depends: none)
- [ ] Task 7: Full verification — `bun install` (must complete clean), `bun test` (0 fail), `bun run lint` (0 error), `bun run typecheck` (0 error). Report evidence. (depends: Task 1, Task 2, Task 3, Task 4, Task 5, Task 6)

## Acceptance

- `bun install` completes with no native-build failure.
- `bun test` 0 fail; `bun run lint` 0 error; `bun run typecheck` 0 error.
