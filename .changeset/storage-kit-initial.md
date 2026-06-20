---
"@iskra-bun/storage-kit": minor
---

Initial public release. Transport-agnostic file-storage kit extracted from web-kit: `StorageAdapter`/`BaseStorageAdapter`, local and S3/MinIO adapters, and a `createStorageAdapter` factory. Adds `getStream()` to stream files without buffering them entirely in memory.
