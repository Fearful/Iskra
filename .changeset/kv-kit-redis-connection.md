---
"@iskra-bun/kv-kit": minor
"@iskra-bun/core": patch
---

Redis connection fixes for kv-kit (also used by cache-kit's `RedisAdapter`).

- `connection: { url }`, as shown in the docs, was ignored by ioredis, so the adapter silently connected to `localhost:6379` db 0. The URL is now honored; a plain URL string or regular ioredis options also work.
- Fractional TTLs (e.g. `0.5`) use `PX` instead of failing on Redis `EX`, and `mset` reports errors from individual pipelined commands instead of ignoring them.
- `disconnect()` uses `QUIT`, so in-flight writes are not dropped.
- **Breaking:** operations before `connect()` now throw instead of silently doing nothing, and an unsupported `kv.driver` (such as `"libsql"`, which never had an adapter and fell back to memory) now throws at `init()`. `AppConfig.kv.driver` is `"memory" | "redis"`.
