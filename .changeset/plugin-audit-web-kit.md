---
"@iskra-bun/web-kit": minor
---

**Security:** what a feature or its composition could silently switch off in the resulting app.

- **Breaking:** `Kernel.initialize()` throws when routes were added to `getApp()` before it. Hono only runs the middleware registered before a route, so those routes (the natural order: register features, add routes, `start()`, as `examples/csrf.ts` did) were served without the security headers, CSRF, rate limiting, sessions or auth. Add routes after `await kernel.initialize()`, or pass them as WebPlugin's `router`. Middleware added with `use()` is still accepted.
- **Breaking:** `initialize()` also throws when a feature adds routes in its `initialize()` instead of `routes()`: they escaped the middleware of the features initialized after it.
- **Breaking:** registering a feature whose name is already taken throws. The second one replaced the first silently, so a helper named `csrf` removed the CSRF check and a second `RateLimitFeature` removed the global limit. `RateLimitFeature` takes a `name` for a second limiter, with counters of its own.
- `validateJson()`: one error per failing array item was de-duplicated with `Array.includes()`, so a 117 KiB body blocked the event loop for ~5 s. Formatting is linear, at most 100 errors are reported, and a `__proto__` field path no longer replaces the prototype of `fields`.
- The Kernel's security headers no longer overwrite one the route set itself (a stricter `Content-Security-Policy` or `X-Frame-Options: DENY`), and `strictTransportSecurity.maxAge: 0` is sent as 0 (it became a year).
- `WebDriver` caps request bodies at 16 MiB like the Kernel (`maxRequestBodySize`); Bun's default allowed 128 MiB per request.
- `AuthFeature` takes `cookieCacheMaxAge`: sessions are checked against a signed cookie cache, so a revoked session keeps working for that long (default 300 s) and it could not be shortened from web-kit.
- `RequestIdFeature` keeps an incoming request ID only if it is visible ASCII up to 200 characters, and `LoggerFeature` escapes control characters of the (decoded) path: `%0A` in a URL wrote forged log lines.
