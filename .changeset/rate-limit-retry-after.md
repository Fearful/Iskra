---
"@iskra-bun/web-kit": patch
---

`RateLimitFeature`'s 429 and the auth routes' 429 now carry `Retry-After`: the seconds until the client's window resets (at least 1), or `windowMs` when the store does not know it (`store: 'cache'`). They sent no hint of when to retry; the client SDKs read it into their rate-limit exception.
