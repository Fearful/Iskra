# @iskra-bun/cache-kit

## 0.2.0

### Minor Changes

- 938dd41: **Security** fixes from the data-kits audit (round 2).

    - `storage-kit` (**breaking**): files are stored and served with a type from their extension (`contentTypeFor`), and anything but a raster image as a download. The S3 adapter stores a `Content-Disposition` with each object (`attachment` unless it is a PNG, JPEG, GIF, WebP, AVIF, BMP or ICO image; `put(..., { contentDisposition })` to choose), and `url()` signs `response-content-type` and `response-content-disposition` into presigned URLs whatever the object was stored with (`url(path, expiresIn, { contentType, contentDisposition })` to choose): an upload named `logo.svg` or `invoice.html` was stored as `image/svg+xml`/`text/html` and ran its scripts on the bucket's origin. HTML, SVG, XML and JavaScript are now `application/octet-stream`. `put(..., { overwrite: false })` throws the new `FileExistsError` instead of replacing a stored file (S3 `If-None-Match: *`, an exclusive create locally); `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` now need 3.635 or later, the first releases that send `If-None-Match` on a put (earlier ones dropped it, and the file was replaced). The plaintext-endpoint guard parses the endpoint as a URL, as the SDK does: `http:/minio:9000`, `http:minio:9000` and `http:\\minio:9000` were accepted without `useSSL: false`; an endpoint that is not an `http(s)` URL is rejected.
    - `web-kit` uploads (**breaking**): the upload route stores a file with the type of its extension, never `File.type` (which Bun derives from the name), and `uploadFromRequest()` too. Downloads are streamed with `getStream()` (each one was buffered twice), typed by extension, `attachment` unless a raster image, and sandboxed (`Content-Security-Policy: sandbox`). Without `allowedExtensions`, active web content (`.html`, `.svg`, `.xml`, `.js`...) is refused (400) unless listed. `authorize(c, action, target)` receives what the action touches (`{ key, subfolder, filename, size, type }`), and `upload` is asked again with it before the file is written. An upload no longer replaces a stored file: **409** unless `overwrite: true`.
    - `mailer-kit` (**breaking**): every `to`, `cc`, `bcc` and `replyTo` entry must be one bare address, or a new `{ name, address }` object for a display name, in every adapter (the mock too); only `from` was checked. One value such as `"bob@example.com <attacker@evil.test>, x@example.com"`, a group (`"undisclosed: a@evil.test; b@x.com"`, `"a@evil.test:b@x.com"`) or `{ address: "bob@example.com\r\nBcc: …" }` mailed other recipients than the ones an allowlist checked. Addresses may not contain whitespace, control characters or `<>()[]\,;:"` and need exactly one `@`; `replyTo` takes one recipient. `checkRecipients()` is exported. Mailgun cuts the `subject` at a CR/LF, as it does header values.
    - `web-kit` email: `EmailFeature`'s adapter checks recipients with mailer-kit's rules (object recipients were tested as `"[object Object]"`), and rejects through the returned promise instead of throwing synchronously.
    - `kv-kit`: the `KVAdapter` contract gains an optional `clear(prefix?)` and expiring sets (`sadd(key, member, ttl?)`, `sdrain(key)`), implemented by both adapters and `KVManager`. `KVManager.clear()` deletes its namespace's keys; with Redis it uses `SCAN` + `DEL` (within ioredis' `keyPrefix` too) and, without a namespace, refuses to empty the whole database unless `new KVManager({ flushDb: true })`. Expiring sets are sorted sets scored by expiry, updated by one atomic script: cache-kit's tag index. The memory adapter stores and returns copies (`structuredClone`), as Redis does (**breaking** for values that cannot be cloned, such as functions): it returned the stored object itself, so one request's mutation showed up in every other.
    - `cache-kit` (**breaking**): `clear()` runs the adapter's `clear()` with the cache's namespace instead of `disconnect()`/`connect()` of the shared adapter, which on Redis deleted nothing (cached permissions stayed), failed concurrent operations meanwhile, and left the adapter dead when the reconnect failed during a Redis blip. A namespaced cache now clears its own entries (it used to throw); an adapter without `clear()` makes it throw. The tag index is kv-kit's expiring set when the adapter has one (one atomic `sadd` per tagged `set()`; each one read and rewrote the whole index, and the last 10k of 40k tagged sets took 30 s), and otherwise a JSON list that drops expired keys, expires with its last entry and keeps at most 10,000 (the oldest are deleted with their data); indexes written before are still drained by `invalidateTag()`. A value with a `__proto__`/`constructor`/`prototype` key is a miss (deleted when read; not stored by `set()`), so `remember()` refetches instead of every read throwing until the TTL ran out. Data keys and namespaces containing `__cache_tag__:`/`__cache_tags__:` (at the start or after a `:`) are rejected: a caller-chosen key could rewrite a tag index, and `invalidateTag()` deleted whatever it listed.
    - `db-kit` (**breaking**): `MigrationHelper` and the CLI run only the drizzle-kit installed in the project (`node_modules/.bin` of the working directory or a parent), with `bunx --no-install drizzle-kit`, and fail with a `MigrationError` where it is not installed. drizzle-kit is a devDependency, so in a production install `bunx drizzle-kit` downloaded its latest release from npm and ran it with `DATABASE_URL` in its environment.

### Patch Changes

- 7e89103: Concurrent `set()` calls with the same tag no longer lose keys from the tag index (within a process), so `invalidateTag()` deletes them all. The prototype-pollution guard also catches an escaped `"__proto__"` key. `remember()` rethrows the fallback's own error instead of wrapping it in a plain `Error`. The memory adapter keeps entries whose TTL exceeds `setTimeout`'s limit, and a negative TTL is rejected.
- 98e05ef: When indexing a tagged entry's tags fails, `set()` deletes the entry it just wrote before rejecting. The entry used to stay cached without being listed under its tags, so `invalidateTag()` never removed it.
- 840439a: Packages declare the runtime they are tested on: `engines.bun` `>=1.3.0` (the monorepo now builds and tests on Bun 1.3). `create-iskra`, a CLI that also runs under `npm create iskra`, declares `engines.node` `>=18`.

    Every package is published with an npm provenance attestation (`publishConfig.provenance`), linking each version to the commit and CI run that built it.

- Updated dependencies [620da18]
- Updated dependencies [b635a2c]
- Updated dependencies [5b2b0fd]
- Updated dependencies [58d4a8f]
- Updated dependencies [5c70c5b]
- Updated dependencies [ec198d4]
- Updated dependencies [cb3ec43]
- Updated dependencies [ef2009b]
- Updated dependencies [840439a]
- Updated dependencies [cb3ec43]
- Updated dependencies [620da18]
- Updated dependencies [87f6de2]
- Updated dependencies [58d4a8f]
- Updated dependencies [dbf8817]
- Updated dependencies [c4ff1e3]
- Updated dependencies [7e89103]
- Updated dependencies [3dc5581]
- Updated dependencies [9872d30]
- Updated dependencies [9bb254d]
- Updated dependencies [f2346f5]
- Updated dependencies [938dd41]
- Updated dependencies [3579944]
    - @iskra-bun/core@0.2.0
    - @iskra-bun/kv-kit@0.3.0

## 0.1.0

### Minor Changes

- f9654df: Initial public release. Higher-level application cache built on `@iskra-bun/kv-kit`: cache-aside (`remember`/`wrap`), TTL, namespaces, and tag-based invalidation, with an in-memory default and Redis support via a kv adapter.

### Patch Changes

- Updated dependencies [f9654df]
- Updated dependencies
- Updated dependencies [f9654df]
- Updated dependencies [f9654df]
- Updated dependencies
- Updated dependencies [f9654df]
    - @iskra-bun/core@0.1.1
    - @iskra-bun/kv-kit@0.2.0
