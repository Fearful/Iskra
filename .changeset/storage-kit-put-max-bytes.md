---
"@iskra-bun/storage-kit": minor
---

New `PutOptions.maxBytes` bounds a `ReadableStream` given to the S3/MinIO adapter's `put()`, which reads it into memory before uploading: a longer stream is cancelled and `put()` rejects with a `RangeError` without uploading anything. It defaults to 5 GiB, S3's limit for a single upload (or the largest Buffer the runtime allows, if smaller), and must be a non-negative integer (else `put()` rejects with a `TypeError` or `RangeError`); a stream used to be read whole, however large. The stream's chunks may be bytes (any `ArrayBuffer` view), `ArrayBuffer`s or strings (stored as UTF-8 and counted by their UTF-8 bytes). The local adapter writes streams straight to disk and ignores it.
