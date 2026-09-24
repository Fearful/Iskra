# @iskra-bun/storage-kit

## 0.1.0

### Minor Changes

- f9654df: Initial public release. Transport-agnostic file-storage kit extracted from web-kit: `StorageAdapter`/`BaseStorageAdapter`, local and S3/MinIO adapters, and a `createStorageAdapter` factory. Adds `getStream()` to stream files without buffering them entirely in memory.

### Patch Changes

- Fix a path-traversal vulnerability in the local filesystem adapter. `sanitizePath` now strips `..` and `.` segments, and the local adapter resolves every path against the storage root and throws `Path escapes storage root` if the result falls outside it. This is enforced on every `put`/`get`/`getStream`/`delete`/`exists`/`isDirectory` call, so a key like `../secret.txt` can no longer read or delete files outside the configured root.
- Updated dependencies [f9654df]
- Updated dependencies
- Updated dependencies [f9654df]
    - @iskra-bun/core@0.1.1
