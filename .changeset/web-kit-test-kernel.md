---
"@iskra-bun/web-kit": minor
---

`createTestKernel({ router, features, ...config })` in `@iskra-bun/web-kit/testing` builds the app as WebPlugin does (features first, then the routes, with the same code) without a port, and returns `{ app, kernel, request, close }`. `mountRoutes()` is the code both use.
