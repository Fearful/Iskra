# @iskra-bun/mailer-kit

## 0.2.1

### Patch Changes

- Updated dependencies [e86ed55]
- Updated dependencies [ae7c798]
- Updated dependencies [ef10372]
    - @iskra-bun/core@0.3.0

## 0.2.0

### Minor Changes

- ef2009b: **Security:** update dependencies with known vulnerabilities (`bun audit` went from 67 findings, 1 critical and 38 high, to one accepted dev-only finding).

    - `better-auth` ^1.6.33 (account takeover via pre-account hijacking), `hono` ^4.12.34, `ajv` ^8.20.0, `mysql2` ^3.24.4 (web-kit, auth-kit, db-kit).
    - `drizzle-orm` ^0.45.2 (SQL injection via improperly escaped identifiers). **db-kit moves from 0.30 to 0.45**, the same line web-kit and auth-kit already used, so schemas are shared across kits again; `drizzle-kit` ^0.31.11 now matches it (0.30 exited with "requires newer version of drizzle-orm", so migrations never ran), and `@libsql/client` ^0.18.0 satisfies drizzle's peer range.
    - `c12` ^3.3.4 in core (drops the vulnerable `tar` 6 pulled in through `giget` 1).
    - `nodemailer` ^10.0.10 in mailer-kit (arbitrary file read / SSRF via the raw option, SMTP command and header injection).

- 31a3a94: **Breaking (0.x):** `Reply-To` is no longer accepted in a message's `headers`: set it with `message.replyTo`. The header's value was only cut at CR/LF, so it could carry several addresses or a display name that `replyTo`'s checks refuse. A `Reply-To` in `headers` now throws `Header "Reply-To" is not allowed: use message.replyTo`.
- 938dd41: **Security** fixes from the data-kits audit (round 2).

    - `storage-kit` (**breaking**): files are stored and served with a type from their extension (`contentTypeFor`), and anything but a raster image as a download. The S3 adapter stores a `Content-Disposition` with each object (`attachment` unless it is a PNG, JPEG, GIF, WebP, AVIF, BMP or ICO image; `put(..., { contentDisposition })` to choose), and `url()` signs `response-content-type` and `response-content-disposition` into presigned URLs whatever the object was stored with (`url(path, expiresIn, { contentType, contentDisposition })` to choose): an upload named `logo.svg` or `invoice.html` was stored as `image/svg+xml`/`text/html` and ran its scripts on the bucket's origin. HTML, SVG, XML and JavaScript are now `application/octet-stream`. `put(..., { overwrite: false })` throws the new `FileExistsError` instead of replacing a stored file (S3 `If-None-Match: *`, an exclusive create locally); `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` now need 3.635 or later, the first releases that send `If-None-Match` on a put (earlier ones dropped it, and the file was replaced). The plaintext-endpoint guard parses the endpoint as a URL, as the SDK does: `http:/minio:9000`, `http:minio:9000` and `http:\\minio:9000` were accepted without `useSSL: false`; an endpoint that is not an `http(s)` URL is rejected.
    - `web-kit` uploads (**breaking**): the upload route stores a file with the type of its extension, never `File.type` (which Bun derives from the name), and `uploadFromRequest()` too. Downloads are streamed with `getStream()` (each one was buffered twice), typed by extension, `attachment` unless a raster image, and sandboxed (`Content-Security-Policy: sandbox`). Without `allowedExtensions`, active web content (`.html`, `.svg`, `.xml`, `.js`...) is refused (400) unless listed. `authorize(c, action, target)` receives what the action touches (`{ key, subfolder, filename, size, type }`), and `upload` is asked again with it before the file is written. An upload no longer replaces a stored file: **409** unless `overwrite: true`.
    - `mailer-kit` (**breaking**): every `to`, `cc`, `bcc` and `replyTo` entry must be one bare address, or a new `{ name, address }` object for a display name, in every adapter (the mock too); only `from` was checked. One value such as `"bob@example.com <attacker@evil.test>, x@example.com"`, a group (`"undisclosed: a@evil.test; b@x.com"`, `"a@evil.test:b@x.com"`) or `{ address: "bob@example.com\r\nBcc: …" }` mailed other recipients than the ones an allowlist checked. Addresses may not contain whitespace, control characters or `<>()[]\,;:"` and need exactly one `@`; `replyTo` takes one recipient. `checkRecipients()` is exported. Mailgun cuts the `subject` at a CR/LF, as it does header values.
    - `web-kit` email: `EmailFeature`'s adapter checks recipients with mailer-kit's rules (object recipients were tested as `"[object Object]"`), and rejects through the returned promise instead of throwing synchronously.
    - `kv-kit`: the `KVAdapter` contract gains an optional `clear(prefix?)` and expiring sets (`sadd(key, member, ttl?)`, `sdrain(key)`), implemented by both adapters and `KVManager`. `KVManager.clear()` deletes its namespace's keys; with Redis it uses `SCAN` + `DEL` (within ioredis' `keyPrefix` too) and, without a namespace, refuses to empty the whole database unless `new KVManager({ flushDb: true })`. Expiring sets are sorted sets scored by expiry, updated by one atomic script: cache-kit's tag index. The memory adapter stores and returns copies (`structuredClone`), as Redis does (**breaking** for values that cannot be cloned, such as functions): it returned the stored object itself, so one request's mutation showed up in every other.
    - `cache-kit` (**breaking**): `clear()` runs the adapter's `clear()` with the cache's namespace instead of `disconnect()`/`connect()` of the shared adapter, which on Redis deleted nothing (cached permissions stayed), failed concurrent operations meanwhile, and left the adapter dead when the reconnect failed during a Redis blip. A namespaced cache now clears its own entries (it used to throw); an adapter without `clear()` makes it throw. The tag index is kv-kit's expiring set when the adapter has one (one atomic `sadd` per tagged `set()`; each one read and rewrote the whole index, and the last 10k of 40k tagged sets took 30 s), and otherwise a JSON list that drops expired keys, expires with its last entry and keeps at most 10,000 (the oldest are deleted with their data); indexes written before are still drained by `invalidateTag()`. A value with a `__proto__`/`constructor`/`prototype` key is a miss (deleted when read; not stored by `set()`), so `remember()` refetches instead of every read throwing until the TTL ran out. Data keys and namespaces containing `__cache_tag__:`/`__cache_tags__:` (at the start or after a `:`) are rejected: a caller-chosen key could rewrite a tag index, and `invalidateTag()` deleted whatever it listed.
    - `db-kit` (**breaking**): `MigrationHelper` and the CLI run only the drizzle-kit installed in the project (`node_modules/.bin` of the working directory or a parent), with `bunx --no-install drizzle-kit`, and fail with a `MigrationError` where it is not installed. drizzle-kit is a devDependency, so in a production install `bunx drizzle-kit` downloaded its latest release from npm and ran it with `DATABASE_URL` in its environment.

### Patch Changes

- 840439a: Packages declare the runtime they are tested on: `engines.bun` `>=1.3.0` (the monorepo now builds and tests on Bun 1.3). `create-iskra`, a CLI that also runs under `npm create iskra`, declares `engines.node` `>=18`.

    Every package is published with an npm provenance attestation (`publishConfig.provenance`), linking each version to the commit and CI run that built it.

- d1b8652: The Mailgun adapter requires a sender, like the SMTP, SendGrid and SES adapters: with no `from` on the message or in the config, `send()` throws `From address required` before calling Mailgun. It used to post the message without one, which Mailgun rejects with a 400.
- 7e89103: Each SendGrid adapter uses its own client: the shared default client meant the last adapter created set the API key for all of them. The `from` display name is quoted or encoded by every adapter, so a name with quotes can no longer add another sender, and malformed addresses are rejected. SMTP and SendGrid forward `headers` (with the Mailgun allowlist) instead of dropping them; SendGrid base64-encodes string attachments. SES rejects messages with attachments or headers instead of silently sending them without.
- 916b58d: The SES adapter builds one `SESv2Client` on its first send and reuses it, instead of building a new client (and its connection pool) for every message. A failed SDK import is not cached: the next send retries it.
- Updated dependencies [620da18]
- Updated dependencies [b635a2c]
- Updated dependencies [5b2b0fd]
- Updated dependencies [58d4a8f]
- Updated dependencies [5c70c5b]
- Updated dependencies [ec198d4]
- Updated dependencies [cb3ec43]
- Updated dependencies [ef2009b]
- Updated dependencies [840439a]
- Updated dependencies [dbf8817]
- Updated dependencies [3dc5581]
- Updated dependencies [9872d30]
- Updated dependencies [f2346f5]
- Updated dependencies [3579944]
    - @iskra-bun/core@0.2.0

## 0.1.0

### Minor Changes

- f9654df: Initial public release. Transport-agnostic email kit extracted from web-kit: `EmailAdapter` interface, `MockEmailAdapter`, SMTP/SendGrid/Mailgun/SES providers, and a `createEmailAdapter` factory — usable from workers and cron jobs without an HTTP layer. The previously-unimplemented SES provider is now complete.

### Patch Changes

- Mailer hardening across providers:

    - `sendTemplate` now throws `sendTemplate not supported by <provider>` for the SMTP, Mailgun, SES and SendGrid providers instead of silently reporting success without sending anything.
    - The SMTP provider enforces TLS: `secure: true` on port 465, otherwise `requireTLS: true`, with `tls.rejectUnauthorized: true`.
    - The Mailgun provider applies a custom-header allowlist (throwing on non-allowlisted headers) and strips CR/LF from header values, preventing email header injection.

- Updated dependencies [f9654df]
- Updated dependencies
- Updated dependencies [f9654df]
    - @iskra-bun/core@0.1.1
