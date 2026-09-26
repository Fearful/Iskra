---
"@iskra-bun/web-kit": patch
---

`Kernel#getFeatureNames()` returns the names of the registered features, in registration order. `HealthCheckFeature` uses it for `includeDetails` instead of reading the Kernel's private feature map.
