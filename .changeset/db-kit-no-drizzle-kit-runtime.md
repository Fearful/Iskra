---
"@iskra-bun/db-kit": patch
---

`import "@iskra-bun/db-kit"` no longer requires `drizzle-kit` at runtime. Bun loads the package from `src/` (the `bun` export condition), where `createDrizzleConfig` imported `defineConfig` from `drizzle-kit`, a devDependency, so apps installed with `--production` (like the template Docker builds) failed to start. `createDrizzleConfig` now returns a plain object typed as the new `DrizzleKitConfig`, and the published types no longer reference `drizzle-kit`.
