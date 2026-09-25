---
"@iskra-bun/web-kit": minor
---

Typed feature registry: `kernel.getFeature("cache")` returns `CacheFeature | undefined` (likewise every built-in feature name), so features and apps use each other's API without casts. Add your own features to the `FeatureRegistry` interface with declaration merging (`declare module "@iskra-bun/web-kit" { interface FeatureRegistry { audit: AuditFeature } }`). Other names keep working as before with `getFeature<T>(name)`. `DbFeature.adapter` is typed as the configured dialect instead of `string`.
