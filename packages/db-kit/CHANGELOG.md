# @iskra-bun/db-kit

## 0.3.0

### Minor Changes

- bf6f901: Runtime fixes.

    - `start()` does a `SELECT 1` round-trip before reporting "DB connected successfully". postgres-js and mysql2 connect lazily, so a wrong host or password used to surface only on the first query; `start()` now fails with a `ConnectionError` (credentials scrubbed) and closes the client.
    - `runMigrations(schemaPath, migrationsDir)` now applies the migrations generated in `migrationsDir` over the live connection with Drizzle's migrator (postgres, mysql, sqlite, libsql). It used to spawn `drizzle-kit migrate`, which ignored both arguments and failed without a `drizzle.config.ts`. It requires a started driver; `schemaPath` is not needed to apply migrations. Failures are wrapped in `MigrationError`.
    - Docs and CLI help: `drop` deletes a generated migration file (drizzle-kit's `drop`); it never dropped database tables as documented.

- ef2009b: **Security:** update dependencies with known vulnerabilities (`bun audit` went from 67 findings, 1 critical and 38 high, to one accepted dev-only finding).

    - `better-auth` ^1.6.33 (account takeover via pre-account hijacking), `hono` ^4.12.34, `ajv` ^8.20.0, `mysql2` ^3.24.4 (web-kit, auth-kit, db-kit).
    - `drizzle-orm` ^0.45.2 (SQL injection via improperly escaped identifiers). **db-kit moves from 0.30 to 0.45**, the same line web-kit and auth-kit already used, so schemas are shared across kits again; `drizzle-kit` ^0.31.11 now matches it (0.30 exited with "requires newer version of drizzle-orm", so migrations never ran), and `@libsql/client` ^0.18.0 satisfies drizzle's peer range.
    - `c12` ^3.3.4 in core (drops the vulnerable `tar` 6 pulled in through `giget` 1).
    - `nodemailer` ^10.0.10 in mailer-kit (arbitrary file read / SSRF via the raw option, SMTP command and header injection).

- 938dd41: **Security** fixes from the data-kits audit (round 2).

    - `storage-kit` (**breaking**): files are stored and served with a type from their extension (`contentTypeFor`), and anything but a raster image as a download. The S3 adapter stores a `Content-Disposition` with each object (`attachment` unless it is a PNG, JPEG, GIF, WebP, AVIF, BMP or ICO image; `put(..., { contentDisposition })` to choose), and `url()` signs `response-content-type` and `response-content-disposition` into presigned URLs whatever the object was stored with (`url(path, expiresIn, { contentType, contentDisposition })` to choose): an upload named `logo.svg` or `invoice.html` was stored as `image/svg+xml`/`text/html` and ran its scripts on the bucket's origin. HTML, SVG, XML and JavaScript are now `application/octet-stream`. `put(..., { overwrite: false })` throws the new `FileExistsError` instead of replacing a stored file (S3 `If-None-Match: *`, an exclusive create locally); `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` now need 3.635 or later, the first releases that send `If-None-Match` on a put (earlier ones dropped it, and the file was replaced). The plaintext-endpoint guard parses the endpoint as a URL, as the SDK does: `http:/minio:9000`, `http:minio:9000` and `http:\\minio:9000` were accepted without `useSSL: false`; an endpoint that is not an `http(s)` URL is rejected.
    - `web-kit` uploads (**breaking**): the upload route stores a file with the type of its extension, never `File.type` (which Bun derives from the name), and `uploadFromRequest()` too. Downloads are streamed with `getStream()` (each one was buffered twice), typed by extension, `attachment` unless a raster image, and sandboxed (`Content-Security-Policy: sandbox`). Without `allowedExtensions`, active web content (`.html`, `.svg`, `.xml`, `.js`...) is refused (400) unless listed. `authorize(c, action, target)` receives what the action touches (`{ key, subfolder, filename, size, type }`), and `upload` is asked again with it before the file is written. An upload no longer replaces a stored file: **409** unless `overwrite: true`.
    - `mailer-kit` (**breaking**): every `to`, `cc`, `bcc` and `replyTo` entry must be one bare address, or a new `{ name, address }` object for a display name, in every adapter (the mock too); only `from` was checked. One value such as `"bob@example.com <attacker@evil.test>, x@example.com"`, a group (`"undisclosed: a@evil.test; b@x.com"`, `"a@evil.test:b@x.com"`) or `{ address: "bob@example.com\r\nBcc: …" }` mailed other recipients than the ones an allowlist checked. Addresses may not contain whitespace, control characters or `<>()[]\,;:"` and need exactly one `@`; `replyTo` takes one recipient. `checkRecipients()` is exported. Mailgun cuts the `subject` at a CR/LF, as it does header values.
    - `web-kit` email: `EmailFeature`'s adapter checks recipients with mailer-kit's rules (object recipients were tested as `"[object Object]"`), and rejects through the returned promise instead of throwing synchronously.
    - `kv-kit`: the `KVAdapter` contract gains an optional `clear(prefix?)` and expiring sets (`sadd(key, member, ttl?)`, `sdrain(key)`), implemented by both adapters and `KVManager`. `KVManager.clear()` deletes its namespace's keys; with Redis it uses `SCAN` + `DEL` (within ioredis' `keyPrefix` too) and, without a namespace, refuses to empty the whole database unless `new KVManager({ flushDb: true })`. Expiring sets are sorted sets scored by expiry, updated by one atomic script: cache-kit's tag index. The memory adapter stores and returns copies (`structuredClone`), as Redis does (**breaking** for values that cannot be cloned, such as functions): it returned the stored object itself, so one request's mutation showed up in every other.
    - `cache-kit` (**breaking**): `clear()` runs the adapter's `clear()` with the cache's namespace instead of `disconnect()`/`connect()` of the shared adapter, which on Redis deleted nothing (cached permissions stayed), failed concurrent operations meanwhile, and left the adapter dead when the reconnect failed during a Redis blip. A namespaced cache now clears its own entries (it used to throw); an adapter without `clear()` makes it throw. The tag index is kv-kit's expiring set when the adapter has one (one atomic `sadd` per tagged `set()`; each one read and rewrote the whole index, and the last 10k of 40k tagged sets took 30 s), and otherwise a JSON list that drops expired keys, expires with its last entry and keeps at most 10,000 (the oldest are deleted with their data); indexes written before are still drained by `invalidateTag()`. A value with a `__proto__`/`constructor`/`prototype` key is a miss (deleted when read; not stored by `set()`), so `remember()` refetches instead of every read throwing until the TTL ran out. Data keys and namespaces containing `__cache_tag__:`/`__cache_tags__:` (at the start or after a `:`) are rejected: a caller-chosen key could rewrite a tag index, and `invalidateTag()` deleted whatever it listed.
    - `db-kit` (**breaking**): `MigrationHelper` and the CLI run only the drizzle-kit installed in the project (`node_modules/.bin` of the working directory or a parent), with `bunx --no-install drizzle-kit`, and fail with a `MigrationError` where it is not installed. drizzle-kit is a devDependency, so in a production install `bunx drizzle-kit` downloaded its latest release from npm and ran it with `DATABASE_URL` in its environment.

### Patch Changes

- 58d4a8f: `import "@iskra-bun/db-kit"` no longer requires `drizzle-kit` at runtime. Bun loads the package from `src/` (the `bun` export condition), where `createDrizzleConfig` imported `defineConfig` from `drizzle-kit`, a devDependency, so apps installed with `--production` (like the template Docker builds) failed to start. `createDrizzleConfig` now returns a plain object typed as the new `DrizzleKitConfig`, and the published types no longer reference `drizzle-kit`.
- 7e89103: `transaction()` with `sqlite` now rolls back when the async callback throws: Drizzle's bun-sqlite transaction is synchronous and committed as soon as the callback returned its promise. sqlite transactions run one at a time, and a nested `transaction()` call is rejected instead of waiting for itself. `scrubUrl()` and `scrubCredentials()` also redact secret query parameters such as libsql's `authToken`, and passwords containing a raw `@` or `/`; the connection error's context no longer carries the libsql token.
- 840439a: Packages declare the runtime they are tested on: `engines.bun` `>=1.3.0` (the monorepo now builds and tests on Bun 1.3). `create-iskra`, a CLI that also runs under `npm create iskra`, declares `engines.node` `>=18`.

    Every package is published with an npm provenance attestation (`publishConfig.provenance`), linking each version to the commit and CI run that built it.

- cb3ec43: Register what each kit puts on the app with core's new registries: `app.context.get('db' | 'kv' | 'oracle')` returns the kit's driver, and the `process:*`, `socket:connected` / `socket:disconnected` and `worker:dead-letter` events have typed payloads. `ProcessManager.send()` takes `unknown` data.
- 87f6de2: `KVManager` throws when its constructor gets `adapter`, `driver` or `connection`: the store is chosen by the App config (`kv: { driver, connection }`), and the README's `new KVManager({ adapter: 'redis' })` was silently ignored, leaving the app on per-process memory. Without a `kv` driver it now logs a warning in production instead of an info line. The READMEs of kv-kit, worker-kit (`connection` and `queueName`, not `queue`), db-kit (the App's `db` config) and process-kit (the App's `processes` config) show working examples.
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

## 0.2.0

### Minor Changes

- f9654df: New DB features and a migration fix:

    - **Fix:** `MigrationHelper` now passes `schemaPath`/`migrationsDir` (and an optional `configPath`) to drizzle-kit as `--schema`/`--out`/`--config` flags per command, instead of silently ignoring them when no `drizzle.config.ts` sits in the cwd.
    - `DbDriver.transaction(fn)` — typed wrapper around Drizzle's transaction so callers don't reach into the raw `db`.
    - `DbDriver.setOnQuery(cb)` — observability hook wired through Drizzle's logger to surface executed SQL + params.
    - `DbDriver.ping()` — runs a trivial liveness query and resolves `true`/`false` (never rejects), suitable for readiness probes.

### Patch Changes

- f9654df: `DbDriver` and `DbFeature` now accept an optional schema generic (`DbDriver<TSchema>` / `DbFeature<TSchema>`), so `.db` is a typed Drizzle database instead of `any` — opt-in callers get typed relational queries and autocomplete. The generic defaults preserve existing behavior, so no call site needs changes; consumers that relied on `any` may need to add a type argument or annotation.
- f9654df: Scrub credentials from the URL placed in `ConnectionError` context so passwords no longer leak into structured logs, and scrub `//user:pass@` credentials out of drizzle-kit stderr before storing it in `MigrationError` context. The MySQL driver now uses a connection pool (`createPool`) instead of a single serialized connection — note that `createPool` changes the MySQL lifecycle (pooled connections vs. a single serialized connection), so teardown now drains the pool via `end()`. `DbDriver.stop()` is hardened to swallow a throwing `end()`/`close()` (logging via `app.logger`) and to null the `client`/`db` handles so a post-stop `ping()`/`transaction()` hits the not-started guard instead of an already-closed connection.
- Scrub `//user:pass@` credentials out of the drizzle-kit stderr captured in `MigrationError.context.stderr`, so connection passwords no longer leak into migration error logs. Non-credential diagnostic text in stderr is preserved.
- Updated dependencies [f9654df]
- Updated dependencies
- Updated dependencies [f9654df]
    - @iskra-bun/core@0.1.1

## 0.1.0

### Minor Changes

- Initial public release.
