---
"@iskra-bun/storage-kit": patch
---

The AWS SDK is loaded when the first `S3StorageAdapter` is created, not when the package is imported. The index re-exports the S3 adapter, whose module imported the SDK statically, so every app importing storage-kit or web-kit loaded it (about 190 ms of startup, plus its memory) even when it only stored files locally. The API is unchanged.
