---
"@iskra-bun/storage-kit": minor
---

New `PutOptions.maxBytes` bounds a `ReadableStream` given to the S3/MinIO adapter's `put()`, which reads it into memory before uploading: a longer stream is cancelled and `put()` rejects with a `RangeError` without uploading anything. It defaults to 5 GiB, S3's limit for a single upload; a stream used to be read whole, however large. The local adapter writes streams straight to disk and ignores it.
