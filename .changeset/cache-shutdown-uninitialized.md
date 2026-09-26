---
"@iskra-bun/web-kit": patch
---

`CacheFeature#shutdown()` no longer throws when `initialize()` never ran (another feature failed to start first, say); it has no client to disconnect and resolves.
