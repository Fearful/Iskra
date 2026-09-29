---
"@iskra-bun/web-kit": minor
---

`hono` is now a peer dependency (`^4.12.34`) instead of a dependency, and web-kit re-exports it from `@iskra-bun/web-kit/hono`: `Hono`, `HTTPException`, `createMiddleware`, the `Context`/`MiddlewareHandler`/`Env`/`Next` types and the status code types, plus `isHTTPException()` and `statusText()`. An app that imported `hono` on its own could get a second copy, and then a `HTTPException` it threw was not an `instanceof` web-kit's: the Kernel's error handler and `ErrorHandlerFeature` answered it with a 500. Both now recognize a `HTTPException` from any copy by its shape, so it keeps its status. The unused `@hono/zod-validator` dependency is gone. **Breaking:** with a package manager that does not install peers (Yarn 1), add `hono` to the app.
