---
"@iskra-bun/kv-kit": minor
---

New KV features and a leak fix:

- **Fix:** the in-memory adapter no longer leaks TTL timers — expiry timers are tracked and cleared on overwrite/delete/disconnect, so overwriting a key can't have a stale timer delete the fresh value.
- `KVManager` accepts a `namespace` option that transparently prefixes every key, preventing cross-module collisions.
- Batch operations `mget`/`mset`/`mdel` on `KVManager`.
