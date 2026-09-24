---
"@iskra-bun/web-kit": minor
---

- The Kernel initializes every feature before registering any feature's routes, so a feature's middleware (CSRF, rate limit, auth, CORS) now also applies to the routes of features registered before it; `HealthCheckFeature` registers its routes in `routes()`.
- `AuthFeature`: better-auth's own rate limiter gets the real client IP (it put every client without `X-Forwarded-For` in one bucket, so three failed sign-ins by anyone locked everyone out); `rateLimit: false` turns it off too. The web-kit limiter counts only `POST` attempts, not session reads, OAuth callbacks or sign-out. `baseURL` falls back to `BETTER_AUTH_URL` and is required in production (the `http://localhost:3000` default sent cookies without `Secure`).
- `ApiKeyFeature` no longer caches keys: the cached entry held the plaintext key, and a revoked or narrowed key kept its old scopes for `cacheTtl`. `enableCache` and `cacheTtl` are ignored.
- `OpenAPIFeature` serves routes added after initialization (they were in the spec but answered 404). An `HTTPException` with a custom response (hono's `basicAuth`) is sent as is. `RateLimitFeature` with `store: "cache"` requires the cache feature instead of silently using memory. Readiness checks time out after `checkTimeoutMs`. The db session store retries creating its table after a failure. `WebDriver` validates a body schema whatever the `Content-Type` and no longer sends `X-XSS-Protection`.
- Docs: the security headers actually sent, and a working Quick Start.
