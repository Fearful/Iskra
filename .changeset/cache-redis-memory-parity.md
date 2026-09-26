---
"@iskra-bun/web-kit": minor
---

**Breaking (0.x):** `CacheFeature`'s Redis and memory adapters now behave alike. The Redis adapter writes every value as JSON, strings included: it stored strings raw and parsed everything on read, so `'123'` came back as the number `123` and `'true'` as `true` (raw strings stored by older versions are still read as they are). A counter must therefore be stored as a number (`set('k', 5)`) or created by `increment()`: `set('k', '5')` now stores `"5"`, which Redis `INCR` refuses. A fractional TTL (`0.5` seconds) is sent to Redis as milliseconds (`PX`); `EX` took only whole seconds, so Redis rejected it. The memory adapter's `increment()` on a missing or expired key now creates it with the value 1 and returns 1, as Redis `INCR` does; it returned 0 and stored nothing. The unreachable fallback to the memory adapter when constructing the Redis client is gone (ioredis connects in the background and never threw there).
