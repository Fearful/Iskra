---
"@iskra-bun/web-kit": minor
---

**Security (breaking behavior):** `RateLimitFeature` and the auth-route limiter no longer trust `X-Forwarded-For` / `X-Real-IP` by default. They keyed on the raw header, so any client could rotate it to bypass the limit (and grow the in-memory map), while clients without the header all shared one `"unknown"` bucket. The client IP is now the socket address; apps behind a reverse proxy must set `new Kernel({ trustProxy: n })` (number of proxies, `true` = 1) to key on the forwarded address. New `getClientIp(c, trustProxy)` helper and `Kernel#getConfig()`.

Also: the Redis-backed rate-limit counter is now incremented atomically with its expiry (`CacheAdapter.incrementWithTtl`), fixing a race where a counter could lose its TTL and block a client permanently, and the auth limiter now evicts expired entries.
