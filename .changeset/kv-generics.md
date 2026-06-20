---
"@iskra-bun/kv-kit": patch
---

`KVAdapter.get`/`set` are now generic (`get<T>()` returns `Promise<T | undefined>`, `set<T>(key, value: T)`) — values are typed instead of `any`. Reads of a missing key now resolve to `undefined` (previously `null` on the Redis adapter). Consumers relying on `any` may need an explicit type argument when reading.
