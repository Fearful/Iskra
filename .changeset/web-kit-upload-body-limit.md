---
"@iskra-bun/web-kit": patch
---

`UploadFeature` with `exposeRoutes` fails at `initialize()` when `maxFileSize` (plus 64 KiB of multipart overhead) exceeds the Kernel's `maxRequestBodySize` (16 MiB by default). Bun rejected such uploads with a bare 413 before the route ran, so a larger `maxFileSize` silently never took effect.
