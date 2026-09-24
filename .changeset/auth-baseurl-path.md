---
"@iskra-bun/web-kit": patch
---

`AuthFeature` throws at construction when `baseURL` has a path other than `basePath`. better-auth then ignores `basePath` and serves its routes under the `baseURL` path while the feature mounts them at `basePath`, so every auth request returned 404 (e.g. `baseURL: "http://localhost/admin/api"` behind a proxy prefix). The error names the origin to use instead.
