---
"@iskra-bun/db-kit": patch
"@iskra-bun/web-kit": patch
---

`DbDriver` and `DbFeature` now accept an optional schema generic (`DbDriver<TSchema>` / `DbFeature<TSchema>`), so `.db` is a typed Drizzle database instead of `any` — opt-in callers get typed relational queries and autocomplete. The generic defaults preserve existing behavior, so no call site needs changes; consumers that relied on `any` may need to add a type argument or annotation.
