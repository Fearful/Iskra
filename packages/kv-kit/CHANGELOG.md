# @iskra-bun/kv-kit

## 0.2.0

### Minor Changes

- f9654df: New KV features and a leak fix:

    - **Fix:** the in-memory adapter no longer leaks TTL timers — expiry timers are tracked and cleared on overwrite/delete/disconnect, so overwriting a key can't have a stale timer delete the fresh value.
    - `KVManager` accepts a `namespace` option that transparently prefixes every key, preventing cross-module collisions.
    - Batch operations `mget`/`mset`/`mdel` on `KVManager`.

### Patch Changes

- f9654df: `KVAdapter.get`/`set` are now generic (`get<T>()` returns `Promise<T | undefined>`, `set<T>(key, value: T)`) — values are typed instead of `any`. Reads of a missing key now resolve to `undefined` (previously `null` on the Redis adapter). Consumers relying on `any` may need an explicit type argument when reading.
- Fix value corruption in the Redis adapter's `set`/`get` codec. Values are now encoded with a single `JSON.stringify` and decoded with `JSON.parse`, so round-tripping is lossless: strings like `'123'` and `'{}'` stay strings, `undefined` is preserved instead of being stored as the literal text `"undefined"`, and `null` decodes back to `undefined`.
- Updated dependencies [f9654df]
- Updated dependencies
- Updated dependencies [f9654df]
    - @iskra-bun/core@0.1.1

## 0.1.0

### Minor Changes

- Initial public release.
