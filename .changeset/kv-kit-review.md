---
"@iskra-bun/kv-kit": patch
---

The Redis driver connects at `start()` and fails it when Redis is unreachable or rejects the password, instead of failing (or hanging) on the first command; ioredis connection errors go to the app's logger. The memory adapter keeps keys whose TTL exceeds `setTimeout`'s ~24.8-day limit (they expired at once), and a negative or non-finite TTL is rejected with a `RangeError` by both adapters. The docs no longer claim that `Date` or `Map` values round-trip through Redis.
