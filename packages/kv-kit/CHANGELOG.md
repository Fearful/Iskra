# @iskra-bun/kv-kit

## 0.3.1

### Patch Changes

- Updated dependencies [e86ed55]
- Updated dependencies [ae7c798]
- Updated dependencies [ef10372]
    - @iskra-bun/core@0.3.0

## 0.3.0

### Minor Changes

- 87f6de2: `KVManager` throws when its constructor gets `adapter`, `driver` or `connection`: the store is chosen by the App config (`kv: { driver, connection }`), and the README's `new KVManager({ adapter: 'redis' })` was silently ignored, leaving the app on per-process memory. Without a `kv` driver it now logs a warning in production instead of an info line. The READMEs of kv-kit, worker-kit (`connection` and `queueName`, not `queue`), db-kit (the App's `db` config) and process-kit (the App's `processes` config) show working examples.
- 58d4a8f: `KVManager` registers itself in the app context as `'kv'` (as db-kit does with `'db'`) and exposes the underlying ioredis client as `client` (Redis driver, after `start()`; it bypasses `namespace` and the JSON codec) for commands the KV API does not cover, such as sets. forms-app's services read `app.context.get('kv').client`, which was always `undefined`, so they silently skipped every Redis read and write and no published form could be found.
- dbf8817: Redis connection fixes for kv-kit (also used by cache-kit's `RedisAdapter`).

    - `connection: { url }`, as shown in the docs, was ignored by ioredis, so the adapter silently connected to `localhost:6379` db 0. The URL is now honored; a plain URL string or regular ioredis options also work.
    - Fractional TTLs (e.g. `0.5`) use `PX` instead of failing on Redis `EX`, and `mset` reports errors from individual pipelined commands instead of ignoring them.
    - `disconnect()` uses `QUIT`, so in-flight writes are not dropped.
    - **Breaking:** operations before `connect()` now throw instead of silently doing nothing, and an unsupported `kv.driver` (such as `"libsql"`, which never had an adapter and fell back to memory) now throws at `init()`. `AppConfig.kv.driver` is `"memory" | "redis"`.

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

- cb3ec43: Register what each kit puts on the app with core's new registries: `app.context.get('db' | 'kv' | 'oracle')` returns the kit's driver, and the `process:*`, `socket:connected` / `socket:disconnected` and `worker:dead-letter` events have typed payloads. `ProcessManager.send()` takes `unknown` data.
- 620da18: `RedisAdapter.disconnect()` (and so `KVManager.stop()`) no longer waits for Redis's reconnect attempts when the server is down: the client is closed at once. ioredis queued `QUIT` behind the pending commands, so it took about 10 s (never returned with `maxRetriesPerRequest: null`) and used up the app's shutdown timeout. When connected, `QUIT` is given at most 2 s.
- c4ff1e3: The Redis adapter's `sdrain()` returns only the members that have not expired, as the memory adapter does. It returned every member still stored, expired ones included, until the next `sadd()` dropped them; it now reads and deletes the set in one script that filters by Redis time.
- 7e89103: The Redis driver connects at `start()` and fails it when Redis is unreachable or rejects the password, instead of failing (or hanging) on the first command; ioredis connection errors go to the app's logger. The memory adapter keeps keys whose TTL exceeds `setTimeout`'s ~24.8-day limit (they expired at once), and a negative or non-finite TTL is rejected with a `RangeError` by both adapters. The docs no longer claim that `Date` or `Map` values round-trip through Redis.
- 9bb254d: **Security** fixes from the plugin audit.

    - `kv-kit`: Redis errors passed to `onError` (and so logged by `KVManager`) and the cause of a failed `connect()` keep only the command's name. ioredis attached its arguments, so a refused login logged the Redis password (`command.args` of AUTH), for example after a password rotation.
    - `socket-kit`: `ctx.broadcast()` and `ctx.join()` refuse a room or topic that is not a string before calling `canPublish`/`canJoin`. A handler passing the client's value on could be given `["global"]`, which passes a deny-list such as `topic !== 'global'` and which Bun's `publish()` turns into `"global"`. The rate limiter logs one warning per connection and window instead of one per dropped frame (a flooding client wrote ~23 bytes of log per byte sent), and a frame that is not JSON is logged at debug level without a stack.
    - `process-kit` (**breaking**): `send()` refuses a string with a line break, which the child read as several messages (send an object to have it JSON-encoded). After a stdout line longer than 1 MiB, the rest of that line is dropped instead of being read as a line of its own, which let text a child echoed come out as a JSON `process:message`. The spawn log line has the command and the number of arguments; the arguments, which can carry credentials, are logged at debug level.
    - `create-iskra`: `scaffold()` only accepts the name of a bundled template (`../x` copied any directory into the new project), and `scripts/sync.ts` refuses symlinks in a template instead of copying their target into the published package.

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

- f9654df: New KV features and a leak fix:

    - **Fix:** the in-memory adapter no longer leaks TTL timers — expiry timers are tracked and cleared on overwrite/delete/disconnect, so overwriting a key can't have a stale timer delete the fresh value.
    - `KVManager` accepts a `namespace` option that transparently prefixes every key, preventing cross-module collisions.
    - Batch operations `mget`/`mset`/`mdel` on `KVManager`.

### Patch Changes

- f9654df: `KVAdapter.get`/`set` are now generic (`get<T>()` returns `Promise<T | undefined>`, `set<T>(key, value: T)`) — values are typed instead of `any`. Reads of a missing key now resolve to `undefined` (previously `null` on the Redis adapter). Consumers relying on `any` may need an explicit type argument when reading.
- Fix value corruption in the Redis adapter's `set`/`get` codec. Values are now encoded with a single `JSON.stringify` and decoded with `JSON.parse`, so round-tripping is lossless: strings like `'123'` and `'{}'` stay strings, `undefined` is preserved instead of being stored as the literal text `"undefined"`, and `null` decodes back to `undefined`.
- Updated dependencies [f9654df]
- Updated dependencies
- Updated dependencies [f9654df]
    - @iskra-bun/core@0.1.1

## 0.1.0

### Minor Changes

- Initial public release.
