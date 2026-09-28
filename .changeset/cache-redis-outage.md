---
"@iskra-bun/web-kit": minor
---

A Redis outage no longer takes the whole site down. `CacheFeature`'s Redis client fails a command after `commandTimeoutMs` (default 2000) instead of queueing it through every reconnect attempt, and logs connection errors through the Kernel logger, once per outage and without the AUTH password; ioredis printed each failed reconnect to the console. `RateLimitFeature` lets requests through without a limit while its store fails, logging an error at most once a minute (`passOnStoreError: false` answers 503 with `Retry-After` instead). `CacheConfig.connection` also takes `url` (`redis://` / `rediss://`), an ACL `username` and `tls`, so managed Redis that requires TLS can be used. `CacheConfig.secret` and `ttl`, which were never read, are marked deprecated.
