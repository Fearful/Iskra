---
"@iskra-bun/storage-kit": patch
---

S3 `list(prefix)` lists the folder `prefix/`, as the local adapter does: `list("acme")` also returned `acme-internal/…` (and the upload routes listed other projects' files). `move()` onto the same path keeps the file instead of deleting it. `copy()` URL-encodes the S3 `CopySource`, so keys with `%`, spaces or non-ASCII characters are copied. A plaintext endpoint is refused whatever the case of its scheme (`HTTP://`).
