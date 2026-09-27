---
"@iskra-bun/storage-kit": patch
---

`PutOptions.public` is marked `@deprecated`: no adapter ever read it, so `put(path, data, { public: true })` stored a private object. Make objects public with a bucket policy (S3/MinIO) or serve them from your app (local).
