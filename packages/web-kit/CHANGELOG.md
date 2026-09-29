# @iskra-bun/web-kit

## 0.3.0

### Minor Changes

- f4c6585: `AuthFeature` accepts `rateLimit: { max?, windowMs? }` to tune the per-IP limit on the auth routes (still 20 requests / 15 min by default), or `rateLimit: false` to turn it off. The fixed limit made a backend that signs users in through the SDKs, all from one IP, lock everyone out after 20 requests.
- 0f1ce5b: **Security:** authorization fixes.

    - `ApiKeyFeature`: an `Authorization: Bearer` token that is not a valid API key no longer returns 401 for every request (it broke JWT/session auth app-wide, public routes included); `requireApiKey()`/`requireScope()` still reject it with the validation error. Cache hits now re-check expiry and ignore keys removed from the config (a Redis cache outlives the restart that rotated them). The `onError`, `onValidated` and `customExtractor` / `"custom"` strategy options are now honored.
    - `PermissionsFeature`: role permissions were pushed into the array returned by `loadPermissions()`; a loader returning a shared/cached array leaked them (including admin `"*"`) to other users. The array is now copied.
    - `AuthFeature` (**breaking**): email/password login is only enabled in `authMode: "email"` (previously hardcoded on, so OIDC deployments still exposed an open `/sign-up/email`); opt back in with the new `enableEmailPassword` option. `enableSelfRegistration: false` is now honored and disables sign-up.
    - `auth-kit`: new `disableSignUp` option for `createBetterAuth`.

- 9a6c080: **Breaking (0.x):** `CacheFeature`'s Redis and memory adapters now behave alike. The Redis adapter writes every value as JSON, strings included: it stored strings raw and parsed everything on read, so `'123'` came back as the number `123` and `'true'` as `true` (raw strings stored by older versions are still read as they are). A counter must therefore be stored as a number (`set('k', 5)`) or created by `increment()`: `set('k', '5')` now stores `"5"`, which Redis `INCR` refuses. A fractional TTL (`0.5` seconds) is sent to Redis as milliseconds (`PX`); `EX` took only whole seconds, so Redis rejected it. The memory adapter's `increment()` on a missing or expired key now creates it with the value 1 and returns 1, as Redis `INCR` does; it returned 0 and stored nothing. The unreachable fallback to the memory adapter when constructing the Redis client is gone (ioredis connects in the background and never threw there).
- 12702ab: A Redis outage no longer takes the whole site down. `CacheFeature`'s Redis client fails a command after `commandTimeoutMs` (default 2000) instead of queueing it through every reconnect attempt, and logs connection errors through the Kernel logger, once per outage and without the AUTH password; ioredis printed each failed reconnect to the console. `RateLimitFeature` lets requests through without a limit while its store fails, logging an error at most once a minute (`passOnStoreError: false` answers 503 with `Retry-After` instead). `CacheConfig.connection` also takes `url` (`redis://` / `rediss://`), an ACL `username` and `tls`, so managed Redis that requires TLS can be used. `CacheConfig.secret` and `ttl`, which were never read, are marked deprecated.
- ef2009b: **Security:** update dependencies with known vulnerabilities (`bun audit` went from 67 findings, 1 critical and 38 high, to one accepted dev-only finding).

    - `better-auth` ^1.6.33 (account takeover via pre-account hijacking), `hono` ^4.12.34, `ajv` ^8.20.0, `mysql2` ^3.24.4 (web-kit, auth-kit, db-kit).
    - `drizzle-orm` ^0.45.2 (SQL injection via improperly escaped identifiers). **db-kit moves from 0.30 to 0.45**, the same line web-kit and auth-kit already used, so schemas are shared across kits again; `drizzle-kit` ^0.31.11 now matches it (0.30 exited with "requires newer version of drizzle-orm", so migrations never ran), and `@libsql/client` ^0.18.0 satisfies drizzle's peer range.
    - `c12` ^3.3.4 in core (drops the vulnerable `tar` 6 pulled in through `giget` 1).
    - `nodemailer` ^10.0.10 in mailer-kit (arbitrary file read / SSRF via the raw option, SMTP command and header injection).

- 4c4a816: **Security:** what a feature or its composition could silently switch off in the resulting app.

    - **Breaking:** `Kernel.initialize()` throws when routes were added to `getApp()` before it. Hono only runs the middleware registered before a route, so those routes (the natural order: register features, add routes, `start()`, as `examples/csrf.ts` did) were served without the security headers, CSRF, rate limiting, sessions or auth. Add routes after `await kernel.initialize()`, or pass them as WebPlugin's `router`. Middleware added with `use()` is still accepted.
    - **Breaking:** `initialize()` also throws when a feature adds routes in its `initialize()` instead of `routes()`: they escaped the middleware of the features initialized after it.
    - **Breaking:** registering a feature whose name is already taken throws. The second one replaced the first silently, so a helper named `csrf` removed the CSRF check and a second `RateLimitFeature` removed the global limit. `RateLimitFeature` takes a `name` for a second limiter, with counters of its own.
    - `validateJson()`: one error per failing array item was de-duplicated with `Array.includes()`, so a 117 KiB body blocked the event loop for ~5 s. Formatting is linear, at most 100 errors are reported, and a `__proto__` field path no longer replaces the prototype of `fields`.
    - The Kernel's security headers no longer overwrite one the route set itself (a stricter `Content-Security-Policy` or `X-Frame-Options: DENY`), and `strictTransportSecurity.maxAge: 0` is sent as 0 (it became a year).
    - `WebDriver` caps request bodies at 16 MiB like the Kernel (`maxRequestBodySize`); Bun's default allowed 128 MiB per request.
    - `AuthFeature` takes `cookieCacheMaxAge`: sessions are checked against a signed cookie cache, so a revoked session keeps working for that long (default 300 s) and it could not be shortened from web-kit.
    - `RequestIdFeature` keeps an incoming request ID only if it is visible ASCII up to 200 characters, and `LoggerFeature` escapes control characters of the (decoded) path: `%0A` in a URL wrote forged log lines.

- f2346f5: **Breaking behavior:** production safeguards now apply unless `NODE_ENV` is `development` or `test`. They applied only to `NODE_ENV=production` exactly, so a deploy that forgot it (or used `staging`) sent session cookies without `Secure`, accepted sample secrets and plain-http auth URLs, honored `disableCSRFCheck` and wrote pretty logs. `NODE_ENV` is also read when the app runs: `bun build` replaced a literal `process.env.NODE_ENV` with `"development"` when it was unset while building, so a compiled binary ignored the value it ran with. `app.start()` logs a warning when `NODE_ENV` is unset. Set `NODE_ENV=development` for local development; the templates' `bun dev` scripts do. New `nodeEnv()`, `isProductionEnv()` and `isDevelopmentEnv()` in `@iskra-bun/core`.
- 938dd41: **Security** fixes from the data-kits audit (round 2).

    - `storage-kit` (**breaking**): files are stored and served with a type from their extension (`contentTypeFor`), and anything but a raster image as a download. The S3 adapter stores a `Content-Disposition` with each object (`attachment` unless it is a PNG, JPEG, GIF, WebP, AVIF, BMP or ICO image; `put(..., { contentDisposition })` to choose), and `url()` signs `response-content-type` and `response-content-disposition` into presigned URLs whatever the object was stored with (`url(path, expiresIn, { contentType, contentDisposition })` to choose): an upload named `logo.svg` or `invoice.html` was stored as `image/svg+xml`/`text/html` and ran its scripts on the bucket's origin. HTML, SVG, XML and JavaScript are now `application/octet-stream`. `put(..., { overwrite: false })` throws the new `FileExistsError` instead of replacing a stored file (S3 `If-None-Match: *`, an exclusive create locally); `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` now need 3.635 or later, the first releases that send `If-None-Match` on a put (earlier ones dropped it, and the file was replaced). The plaintext-endpoint guard parses the endpoint as a URL, as the SDK does: `http:/minio:9000`, `http:minio:9000` and `http:\\minio:9000` were accepted without `useSSL: false`; an endpoint that is not an `http(s)` URL is rejected.
    - `web-kit` uploads (**breaking**): the upload route stores a file with the type of its extension, never `File.type` (which Bun derives from the name), and `uploadFromRequest()` too. Downloads are streamed with `getStream()` (each one was buffered twice), typed by extension, `attachment` unless a raster image, and sandboxed (`Content-Security-Policy: sandbox`). Without `allowedExtensions`, active web content (`.html`, `.svg`, `.xml`, `.js`...) is refused (400) unless listed. `authorize(c, action, target)` receives what the action touches (`{ key, subfolder, filename, size, type }`), and `upload` is asked again with it before the file is written. An upload no longer replaces a stored file: **409** unless `overwrite: true`.
    - `mailer-kit` (**breaking**): every `to`, `cc`, `bcc` and `replyTo` entry must be one bare address, or a new `{ name, address }` object for a display name, in every adapter (the mock too); only `from` was checked. One value such as `"bob@example.com <attacker@evil.test>, x@example.com"`, a group (`"undisclosed: a@evil.test; b@x.com"`, `"a@evil.test:b@x.com"`) or `{ address: "bob@example.com\r\nBcc: …" }` mailed other recipients than the ones an allowlist checked. Addresses may not contain whitespace, control characters or `<>()[]\,;:"` and need exactly one `@`; `replyTo` takes one recipient. `checkRecipients()` is exported. Mailgun cuts the `subject` at a CR/LF, as it does header values.
    - `web-kit` email: `EmailFeature`'s adapter checks recipients with mailer-kit's rules (object recipients were tested as `"[object Object]"`), and rejects through the returned promise instead of throwing synchronously.
    - `kv-kit`: the `KVAdapter` contract gains an optional `clear(prefix?)` and expiring sets (`sadd(key, member, ttl?)`, `sdrain(key)`), implemented by both adapters and `KVManager`. `KVManager.clear()` deletes its namespace's keys; with Redis it uses `SCAN` + `DEL` (within ioredis' `keyPrefix` too) and, without a namespace, refuses to empty the whole database unless `new KVManager({ flushDb: true })`. Expiring sets are sorted sets scored by expiry, updated by one atomic script: cache-kit's tag index. The memory adapter stores and returns copies (`structuredClone`), as Redis does (**breaking** for values that cannot be cloned, such as functions): it returned the stored object itself, so one request's mutation showed up in every other.
    - `cache-kit` (**breaking**): `clear()` runs the adapter's `clear()` with the cache's namespace instead of `disconnect()`/`connect()` of the shared adapter, which on Redis deleted nothing (cached permissions stayed), failed concurrent operations meanwhile, and left the adapter dead when the reconnect failed during a Redis blip. A namespaced cache now clears its own entries (it used to throw); an adapter without `clear()` makes it throw. The tag index is kv-kit's expiring set when the adapter has one (one atomic `sadd` per tagged `set()`; each one read and rewrote the whole index, and the last 10k of 40k tagged sets took 30 s), and otherwise a JSON list that drops expired keys, expires with its last entry and keeps at most 10,000 (the oldest are deleted with their data); indexes written before are still drained by `invalidateTag()`. A value with a `__proto__`/`constructor`/`prototype` key is a miss (deleted when read; not stored by `set()`), so `remember()` refetches instead of every read throwing until the TTL ran out. Data keys and namespaces containing `__cache_tag__:`/`__cache_tags__:` (at the start or after a `:`) are rejected: a caller-chosen key could rewrite a tag index, and `invalidateTag()` deleted whatever it listed.
    - `db-kit` (**breaking**): `MigrationHelper` and the CLI run only the drizzle-kit installed in the project (`node_modules/.bin` of the working directory or a parent), with `bunx --no-install drizzle-kit`, and fail with a `MigrationError` where it is not installed. drizzle-kit is a devDependency, so in a production install `bunx drizzle-kit` downloaded its latest release from npm and ran it with `DATABASE_URL` in its environment.

- 3579944: **Security:** runtime hardening from the second audit round.

    - `process-kit` (**breaking**): a child no longer inherits the app's whole environment. It gets the variables programs need and that carry no secrets (`PATH`, `HOME`, `USER`, `SHELL`, `TERM`, the locale, `TZ`, the temp dir, `NODE_ENV`, and the Windows essentials), plus `env`: `DATABASE_URL`, `AUTH_SECRET`, cloud keys and whatever was loaded from `.env` reached every child, third-party code included. The new `inheritEnv` option (validated by the core config schema, as is `maxPendingStdinBytes`) takes more names to pass, or `true` for all of them as before.
    - `process-kit`: `send()` refuses a message, with one warning until the child catches up, when the bytes still waiting for a child that is not reading its stdin would go over `maxPendingStdinBytes` (8 MiB by default). They piled up in the app's memory without a bound: 256 MiB sent to such a child grew RSS by 263 MiB. `send()` now resolves to whether the message was sent (`false` for every refusal).
    - `core`: OpenTelemetry. The options of each entry of `otel.instrumentations` reach the instrumentation (the config schema kept only `enabled`, so hooks and `redactedQueryParams` were dropped). HTTP spans export URLs with the values of secret-looking query parameters (`SECRET_QUERY_PARAMS`: `token`, `access_token`, `api_key`, `key`, `code`, `state`, `sig`, `X-Amz-Signature`…) replaced by `REDACTED`, through instrumentation-http's `redactedQueryParams` / `redactedQueryParamsServer` (which the app can set) and a `requestHook` for releases without them; the app's own `requestHook` still runs. The startup log shows only the endpoint's origin (its path, query or password can be an API key), and a plain `http://` endpoint on a remote host logs a warning. New exports: `SECRET_QUERY_PARAMS`, `redactUrl()`, `autoInstrumentationOptions()`, `describeOtelEndpoint()`.
    - `web-kit`: `OtelTracingFeature` exported `url.full` as requested (@hono/otel sets it to `c.req.url`): the `?token=` of an email verification link, the token of better-auth's `/reset-password/<token>` and `?api_key=` reached the collector. The values of `SECRET_QUERY_PARAMS` (or the new `redactedQueryParams`) and that path token are now `REDACTED`. New `ignoreIncomingTraceContext` option to start a new trace per request instead of continuing the client's `traceparent` (default unchanged). `@opentelemetry/api` is now a direct dependency (it already came with `@hono/otel`).
    - `web-kit`: `OpenAPIFeature`'s `/docs` page loaded `@scalar/api-reference@latest` on the app's origin. It now loads a pinned release (1.68.0) with its SRI hash and `crossorigin`, sends a Content-Security-Policy (scripts from that host only; requests only to the app and the spec's `servers`), turns off Scalar's web fonts and AI agent (which sends the spec to Scalar's servers), and HTML-escapes the title. New options: `docs: false` serves neither `/openapi.json` nor `/docs`; `authorize(c)` gates both (they are registered before middleware added after `initialize()`, so a `basicAuth()` there did not cover them); `scalar: { src, integrity }` or `false`.
    - `web-kit` (**breaking**): `HealthCheckFeature`'s `/health/ready` lists the check names (`checks`, `failed`) and `/health/live` the `uptime` only with `includeDetails: true`, like `/health`; the names of failed readiness checks are logged instead.
    - `worker-kit` (**breaking**): finished jobs are no longer kept in Redis forever with their payloads (BullMQ's default when `removeOnComplete`/`removeOnFail` are unset, which worker-kit never set). The queue keeps the last 1000 completed jobs and the failed ones of the last 7 days (at most 5000); `defaultJobOptions` or a job's options override it (`false` keeps them all), and both options now take BullMQ's `{ age, count }` form. `result()` of a job removed since rejects. The dead-letter example in the docs logged the whole payload with `console.error`, outside the logger's redaction; it logs ids now.

- c24201a: **Security:** second round of audit fixes.

    - **Breaking:** behind `trustProxy`, the client IP is read only from the new `KernelConfig.clientIpHeader`: `"x-forwarded-for"` (default) or `"x-real-ip"`. `X-Real-IP` used to be the fallback when `X-Forwarded-For` was missing, and the client decides whether it is: behind a proxy that sets only `X-Real-IP` and passes `X-Forwarded-For` through, a made-up `X-Forwarded-For` was a fresh rate-limit bucket on every request (`RateLimitFeature`, the auth limiter, better-auth's `ipAddress`). Such setups must now set `clientIpHeader: "x-real-ip"`. `getClientIp()` takes the header as a third argument.
    - The rate limiters count IPv6 clients by /64 (new `clientIpKey()`), and `::ffff:a.b.c.d` as IPv4. Their memory stores and `CacheFeature`'s memory adapter are capped (`RateLimitConfig.maxKeys`, `AuthConfig.rateLimit.maxKeys`, `CacheConfig.maxEntries`, 100 000 by default, oldest dropped first) and swept every minute; the memory cache used to keep expired entries until they were read again. These timers, and the memory session store's, no longer keep the process alive. The memory cache stores and returns copies (`structuredClone`), as Redis does: it returned the stored object, so one request's change to a cached value reached every other (values that cannot be cloned, such as functions, are rejected).
    - **Breaking:** `CsrfFeature` rejects unsafe requests whose `Origin` is neither the app's own nor in the new `trustedOrigins`, or that come without `Origin` but with `Sec-Fetch-Site: cross-site` (`Sec-Fetch-Site: same-origin` is trusted as is, so a TLS-terminating proxy does not break same-origin forms). A sibling subdomain could set the `_csrf` cookie for the parent domain with a token of its own and submit it along with a logged-in victim's session. Frontends on another origin must be listed in `trustedOrigins`.
    - **Breaking:** the CSRF cookie is `__Host-csrf` by default while it is Secure (only the host itself can set it), `_csrf` when not Secure; a configured `cookieName` is kept.
    - **Breaking:** with `SessionFeature`, CSRF tokens are signed together with the stored session's ID and `regenerateSession()` issues a new one (`c.get("csrfToken")`); anonymous requests keep unbound tokens, and an unbound one is still accepted from the app's own pages (then replaced), since the page that stored the session was rendered with it. A SPA must read the token again after signing in or out. The Kernel orders features by the new `Feature.optionalDependencies`, so CSRF runs after the session whatever the registration order, and `SessionFeature` exposes `c.get("sessionPersisted")`.
    - **Breaking:** the `CsrfFeature` secret must be at least 32 characters, like `SessionFeature`'s.
    - `SessionFeature` saves a session it loaded only if it still exists, checked and written in one step (memory store: synchronously; cache store: the new optional `CacheAdapter.setIfExists()`, Redis `SET ... XX`; database store: an `UPDATE` instead of delete-and-insert). A logout or `regenerateSession()` landing between the old `get()` and `set()` was undone with Redis or a database.
    - `PermissionsFeature` caches permissions and roles for 60 s by default (it was an hour, with no way to drop them), and the new `invalidate(userId)` drops a user's cached copy.
    - **Breaking:** in production `AuthFeature` refuses a `baseURL` (or `BETTER_AUTH_URL`) that is not https, except on `localhost`, `127.0.0.1` and `[::1]`: better-auth marks the session cookies Secure only for an https `baseURL`.
    - **Breaking:** API key scope wildcards are whole segments only: `*` alone or a trailing `:*` (`users:*` grants `users:read` and `users:x:y`, not `usersX`); any other `*` is literal. `user*` used to grant `users:read` and `user-admin:delete`.
    - **Breaking:** `CorsFeature` throws at `initialize()` for `credentials: true` with `origin` unset or `"*"`, which sent `Access-Control-Allow-Origin: *` (rejected by browsers with credentials).
    - The Kernel's security headers keep their default when an option is `undefined`, `null` or empty (e.g. an unset environment variable): it used to remove the header. Only `false` turns one off; `xFrameOptions` and `referrerPolicy` accept `false`.
    - `ErrorHandlerFeature` logs client errors (4xx) at debug level instead of error, so clients cannot flood the error log; 5xx and unexpected errors are still logged as errors.

- 79f5fa8: **Security (breaking behavior):** `RateLimitFeature` and the auth-route limiter no longer trust `X-Forwarded-For` / `X-Real-IP` by default. They keyed on the raw header, so any client could rotate it to bypass the limit (and grow the in-memory map), while clients without the header all shared one `"unknown"` bucket. The client IP is now the socket address; apps behind a reverse proxy must set `new Kernel({ trustProxy: n })` (number of proxies, `true` = 1) to key on the forwarded address. New `getClientIp(c, trustProxy)` helper and `Kernel#getConfig()`.

    Also: the Redis-backed rate-limit counter is now incremented atomically with its expiry (`CacheAdapter.incrementWithTtl`), fixing a race where a counter could lose its TTL and block a client permanently, and the auth limiter now evicts expired entries.

- bcea01e: `RateLimitFeature` no longer counts the health feature's routes (`/health`, `/health/ready`, `/health/live`, or the paths it is configured with): a kubelet probing every 10 seconds from the node's IP went over the default 100 requests per 15 minutes, got 429 on `/health/live` and restarted the pod. `skipHealthChecks: false` counts them again. The limiter also logs a warning once when requests carry `X-Forwarded-For` / `X-Real-IP` but the Kernel has no `trustProxy`, since behind a proxy every client then shares the proxy's bucket. `HealthCheckFeature#paths` lists its routes.
- 20c3a34: **Security (breaking):** `SessionFeature` hardening.

    - Emptying the session (e.g. `delete session.userId` on logout, or `c.set("session", {})`) now deletes the stored session and the cookie. Previously the empty session was simply not saved, so the old data loaded again on the next request and logout silently did nothing with the cache/db stores.
    - New `c.get("regenerateSession")()` issues a fresh session ID and invalidates the old one; call it after login to prevent session fixation.
    - The cookie is `Secure` by default in production (`KernelConfig.environment` or `NODE_ENV`), and always with `sameSite: "None"`; `cookieOptions.secure` still overrides it.
    - The cookie signature is compared in constant time.
    - The `secret` must be at least 32 characters (same bar as `AuthFeature`); shorter secrets now throw.

- 379715a: **Security (breaking):** upload routes and `requireCsrf`.

    - `UploadFeature` with `exposeRoutes: true` now requires an `authorize(c, action)` callback (throws at construction otherwise); the routes previously let anyone list, download, overwrite and delete every file. Pass `authorize: () => true` to keep them public on purpose.
    - Upload bodies are cut off as soon as they exceed `maxFileSize` (plus multipart overhead) instead of being buffered whole first; oversized uploads now return **413** (was 400).
    - Uploaded filenames go through the same `safeBasename` as `uploadFromRequest`, and storage errors are logged instead of being echoed to the client.
    - `requireCsrf()` now actually validates the request token (it only checked that a token existed, which is always true), so it can guard routes whose method is in `ignoreMethods`; it fails closed when `CsrfFeature` is not registered.

- f69e66b: **Breaking (0.x):** `UploadHelper#uploadFromRequest()` (`c.get('upload')`) now applies the upload route's rules. It reads the multipart body only up to `maxFileSize` (plus multipart overhead) and throws an `HttpError` 413 `File too large` past it, and it refuses an extension `allowedExtensions` does not allow (by default, active content such as `.html`, `.svg`, `.js`) with an `HttpError` 400 `Invalid extension`. It used to read any body whole and store any extension. A request without a file in the field is an `HttpError` 400 too (it was a plain `Error`, served as a 500). It follows `UploadFeature`'s `maxFileSize` and `allowedExtensions` (10 MiB and no active content by default).
- db3685c: Typed feature registry: `kernel.getFeature("cache")` returns `CacheFeature | undefined` (likewise every built-in feature name), so features and apps use each other's API without casts. Add your own features to the `FeatureRegistry` interface with declaration merging (`declare module "@iskra-bun/web-kit" { interface FeatureRegistry { audit: AuditFeature } }`). Other names keep working as before with `getFeature<T>(name)`. `DbFeature.adapter` is typed as the configured dialect instead of `string`.
- db3685c: The Kernel and its features log through a logger instead of writing to the console directly. `KernelConfig.logger` takes an object with `debug`/`info`/`warn`/`error(message, details?)`, or `false` for no output; the default is still the console. `WebPlugin` passes the App's logger unless `logger` is set, so web-kit's messages share the app's format, level and sinks, with errors as `{ err }`. Features get it with `kernel.getLogger()`. Each feature's startup message is now `debug` (so an app logging at `info` no longer prints one line per feature), and the "Registered feature" lines are gone. New exports: `KernelLogger`, `consoleLogger`, `silentLogger`, `fromStructuredLogger`. `ValidationOptions` and `JsonValidationOptions` accept a `logger`.
- 8f4885b: Runtime fixes for the `Kernel`, `/health` and `DbFeature`.

    - `/health` now runs its checks on every request (not only with `includeDetails`) and answers **503** with `status: "error"` when one fails. The DB probe actually runs: it called `db.query("SELECT 1")`, but on a Drizzle instance `query` is an object, so the database was never checked. New `DbFeature.ping()` does one round-trip; every check has a timeout (`checkTimeoutMs`, default 2000).
    - `DbFeature` uses a MySQL connection pool instead of a single connection.
    - `Kernel.shutdown()` waits for in-flight requests (bounded by `shutdownGraceMs`, default 5000; Bun 1.1's graceful stop can otherwise hang forever after a 413), shuts features down in reverse dependency order, and continues past a failing feature (throwing an `AggregateError` at the end).
    - A missing peer dependency no longer crashes the process with an unhandled rejection (the `import()` was fired without `await` inside a sync try/catch).
    - **Breaking defaults:** the server binds `0.0.0.0` instead of `localhost` (which was unreachable from outside a container), and request bodies are capped at 16 MiB (`maxRequestBodySize`). `idleTimeout` is configurable.
    - `securityHeaders` is merged over the defaults instead of replacing them, and `X-XSS-Protection` is no longer sent by default (OWASP recommends against it).

- 7720bd5: - The Kernel initializes every feature before registering any feature's routes, so a feature's middleware (CSRF, rate limit, auth, CORS) now also applies to the routes of features registered before it; `HealthCheckFeature` registers its routes in `routes()`.
    - `AuthFeature`: better-auth's own rate limiter gets the real client IP (it put every client without `X-Forwarded-For` in one bucket, so three failed sign-ins by anyone locked everyone out); `rateLimit: false` turns it off too. The web-kit limiter counts only `POST` attempts, not session reads, OAuth callbacks or sign-out. `baseURL` falls back to `BETTER_AUTH_URL` and is required in production (the `http://localhost:3000` default sent cookies without `Secure`).
    - `ApiKeyFeature` no longer caches keys: the cached entry held the plaintext key, and a revoked or narrowed key kept its old scopes for `cacheTtl`. `enableCache` and `cacheTtl` are ignored.
    - `OpenAPIFeature` serves routes added after initialization (they were in the spec but answered 404). An `HTTPException` with a custom response (hono's `basicAuth`) is sent as is. `RateLimitFeature` with `store: "cache"` requires the cache feature instead of silently using memory. Readiness checks time out after `checkTimeoutMs`. The db session store retries creating its table after a failure. `WebDriver` validates a body schema whatever the `Content-Type` and no longer sends `X-XSS-Protection`.
    - Docs: the security headers actually sent, and a working Quick Start.
- cb3ec43: **Breaking:** no more `any` in web-kit's public API, and validation is a typed middleware.

    - `ValidationFeature` and `JsonSchemaValidationFeature` are removed, with the untyped `app.*Validated()` methods and `c.valid()` they added. Use the `validate()` (Zod v3 or v4) and `validateJson()` (JSON Schema) middlewares: the handler reads typed data from `c.get("validated")`. `createValidationMiddleware` / `createJsonSchemaValidationMiddleware` are renamed `validate` / `validateJson`.
    - WebDriver: `RouteOptions` / `WebContext` default to `unknown`; `defineRoute()` infers a route's body and query types from its schema.
    - Sessions: `c.get("session")` is a `SessionData` (fields `unknown` until declared with declaration merging). The DB session store runs typed per-dialect queries.
    - Config callbacks (`authorize`, `keyGenerator`, `skip`, `handler`, `customExtractor`, `onError`, `onValidated`, health `checks`, error handler `customHandlers`/`logger`) receive Hono's `Context`. `CacheAdapter.get()` returns `unknown`. `c.get("logger")` is a `RequestLogger`. `OtelTracingConfig` is `@hono/otel`'s options with `serviceName` required. `ApiKeyConfig.vaultService` (never used) is removed.
    - Internal: DbFeature keeps its client per dialect (typed ping and shutdown); CORS builds Hono's options without casts; cached permissions are validated before use.

    See the "Upgrading to the typed APIs" guide.

### Patch Changes

- 58d4a8f: `AuthFeature` throws at construction when `baseURL` has a path other than `basePath`. better-auth then ignores `basePath` and serves its routes under the `baseURL` path while the feature mounts them at `basePath`, so every auth request returned 404 (e.g. `baseURL: "http://localhost/admin/api"` behind a proxy prefix). The error names the origin to use instead.
- d6151cb: `oidcConfig.mapping` is now applied: `email`, `name`, `image` and `emailVerified` name the claims the user's fields are read from, falling back to the standard claims when the profile lacks them (a mapped `emailVerified` claim counts as verified when it is `true` or `"true"`). A mapped email is verified only by its paired mapped flag, or by the standard `email_verified` when it is the same address, so a verified standard email never vouches for a different mapped one (better-auth links verified emails to existing local users). It was accepted but never read, so a provider with non-standard claim names created users without them. `mapOidcProfile(profile, mapping?)` takes the mapping as an optional second argument. `jwksEndpoint`, `mapping.id` and `mapping.extraFields` are marked `@deprecated` and still ignored: better-auth takes the JWKS only from the discovery document's `jwks_uri`, the account's identity always comes from the verified `sub`, and extra user fields need better-auth `user.additionalFields`.
- 093656f: `oidcConfig` endpoints that are not set now come from the issuer's discovery document. They defaulted to Keycloak's `${issuer}/protocol/openid-connect/{auth,token,userinfo}` paths, and better-auth only fills the endpoints left unset from discovery, so every other provider (Auth0, Okta, Entra ID, …) got URLs that do not exist and sign-in failed unless all three were configured by hand. `authorizationEndpoint`, `tokenEndpoint` and `userinfoEndpoint` still override the discovered ones. The provider config is built by the new exported `oidcProviderConfig(oidcConfig)`; web-kit's `AuthFeature` passes its `oidcConfig` through, so it gets the same behaviour. With only the `issuer` set, the provider now depends on discovery at startup: if the discovery document cannot be fetched then (for example the IdP container starts after the app), better-auth logs the error and leaves the provider out until the app restarts. Set the three endpoints explicitly to avoid that dependency.
- 9e33738: `CacheFeature#shutdown()` no longer throws when `initialize()` never ran (another feature failed to start first, say); it has no client to disconnect and resolves.
- 840439a: Packages declare the runtime they are tested on: `engines.bun` `>=1.3.0` (the monorepo now builds and tests on Bun 1.3). `create-iskra`, a CLI that also runs under `npm create iskra`, declares `engines.node` `>=18`.

    Every package is published with an npm provenance attestation (`publishConfig.provenance`), linking each version to the commit and CI run that built it.

- 2db50cb: `ErrorHandlerFeature` no longer sends the `context` of an `HttpError` with a 5xx status unless `includeStack` is on; the message is still sent. A 5xx's context tends to describe the server (a DSN, a host), not the client's request. 4xx errors keep their `context`.
- 4d1851d: `ErrorHandlerFeature` now includes a `ValidationError`'s `details` in the response body (`{ error, status, code, details }`); they were dropped, so clients never saw which fields failed.
- 8281663: `Kernel#getFeatureNames()` returns the names of the registered features, in registration order. `HealthCheckFeature` uses it for `includeDetails` instead of reading the Kernel's private feature map.
- 7e1a706: `PermissionsFeature` now runs after `auth`, `session` and `cache` whatever the order they are registered in, and none of them is required. It depended on `auth` only, so a session or cache feature registered after it ran too late: a user held in the session was treated as anonymous, and permissions were never cached. Without an auth feature it used to fail at startup; now every request is anonymous and gets only `anonymousPermissions`.
- 650e84d: `RateLimitFeature`'s `X-RateLimit-Reset` header now reports when the client's current window ends. It was `now + windowMs` on every request, so it moved forward with each hit. The memory store reports the window's real end; the `cache` store knows it on the window's first hit and otherwise sends `now + windowMs`, an upper bound.
- a752084: `RateLimitFeature`'s 429 and the auth routes' 429 now carry `Retry-After`: the seconds until the client's window resets (at least 1), or `windowMs` when the store does not know it (`store: 'cache'`). They sent no hint of when to retry; the client SDKs read it into their rate-limit exception.
- 5451bc1: `SessionFeature` with `store: 'db'` no longer swallows database errors: a failure reading, writing or deleting a session is logged and rethrown, so the request fails (500) instead of going on. A failed write used to be followed by a cookie for a session that was never stored, and a failed logout looked like a successful one. A row whose data is not valid JSON is still logged and treated as no session.
- 114ee87: `WebDriver` no longer overwrites a security header a route set itself: a route answering `X-Frame-Options: DENY` (or its own `X-Content-Type-Options` / `Referrer-Policy`) keeps it, and the default is only added when the header is absent, as the Kernel already does.
- 4d1851d: `Kernel` is exported from the package entry as a class again for TypeScript: `types.ts` also re-exported it type-only, and the colliding `export *` made `import { Kernel } from "@iskra-bun/web-kit"; new Kernel()` fail to typecheck (TS1362), although it worked at runtime.
- 5021429: `LoggerFeature` honors its `level` option: only messages at or above it are written (`trace` < `debug` < `info` < `warning` < `error` < `fatal`). It was ignored, so `level: "error"` still printed debug and info messages. Without a `level` everything is written, as before.
- 8ee6d89: `requireAuth(kernel)` reuses the session the `AuthFeature` middleware already read for the request (`c.get('authUser')`) instead of calling `auth.api.getSession` again, which cost a second session lookup on every protected request. It still reads the session itself when the middleware did not set one, and answers 401 without a session as before.
- 6e01b92: Sessions: a request still in flight no longer re-creates a session that another request destroyed meanwhile. Before, a slow request re-saved it when it finished, which undid a logout made in another tab and brought back the old ID after a login's `regenerateSession()`. With the memory store, which handed every request the same object, that old ID, possibly one an attacker had fixed, even came back carrying the login's `userId`. The memory and cache-backed stores now keep and hand out copies of the session data, which must therefore be structured-cloneable.
- 6e01b92: `UploadFeature` with `exposeRoutes` fails at `initialize()` when `maxFileSize` (plus 64 KiB of multipart overhead) exceeds the Kernel's `maxRequestBodySize` (16 MiB by default). Bun rejected such uploads with a bare 413 before the route ran, so a larger `maxFileSize` silently never took effect.
- Updated dependencies [76028ab]
- Updated dependencies [d6151cb]
- Updated dependencies [093656f]
- Updated dependencies [7720bd5]
- Updated dependencies [cb3ec43]
- Updated dependencies [0f1ce5b]
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
- Updated dependencies [d1b8652]
- Updated dependencies [31a3a94]
- Updated dependencies [7e89103]
- Updated dependencies [916b58d]
- Updated dependencies [3dc5581]
- Updated dependencies [8f31aa5]
- Updated dependencies [9872d30]
- Updated dependencies [f2346f5]
- Updated dependencies [c24201a]
- Updated dependencies [938dd41]
- Updated dependencies [3579944]
- Updated dependencies [bff0daa]
- Updated dependencies [6e01b92]
- Updated dependencies [568aba8]
- Updated dependencies [7e89103]
    - @iskra-bun/auth-kit@0.2.0
    - @iskra-bun/core@0.2.0
    - @iskra-bun/mailer-kit@0.2.0
    - @iskra-bun/storage-kit@0.2.0

## 0.2.0

### Minor Changes

- **Breaking:** public class renames for naming consistency with the `Driver`/`Feature` conventions:

    - `WebServer` → `WebDriver` (same `{ port, routes }` options).
    - `HealthFeature` → `HealthCheckFeature`.

    Update imports accordingly: `import { WebDriver } from '@iskra-bun/web-kit'`. See the "Upgrading to 0.2" guide for the full migration. (Pre-1.0, but bumped as a minor to signal the break.)

### Patch Changes

- f9654df: `DbDriver` and `DbFeature` now accept an optional schema generic (`DbDriver<TSchema>` / `DbFeature<TSchema>`), so `.db` is a typed Drizzle database instead of `any` — opt-in callers get typed relational queries and autocomplete. The generic defaults preserve existing behavior, so no call site needs changes; consumers that relied on `any` may need to add a type argument or annotation.
- f9654df: Internal refactor: the email, storage, and auth features now delegate to the new standalone `@iskra-bun/mailer-kit`, `@iskra-bun/storage-kit`, and `@iskra-bun/auth-kit` packages instead of bundling their own copies. The public API (`EmailFeature`, `StorageFeature`, `AuthFeature`, and the types/adapters they re-export) is unchanged. The now-transitive `nodemailer`, `@sendgrid/mail`, and `@aws-sdk/*` direct dependencies were dropped. Note: `MockEmailAdapter` no longer prints a `console.log` line on send (it is now silent).
- Security fixes for the web server:

    - The health endpoint no longer leaks internal details by default: `includeDetails` defaults to `false`, failing feature/custom/db checks return only `{ status: 'error' }`, and the raw error is logged server-side only instead of being returned in the response.
    - API keys are no longer used verbatim as cache keys — the cache key is now a SHA-256 hash of the key, so raw secrets are kept out of the cache layer.
    - The CSRF kill-switch (`disableCSRFCheck`) is ignored in production: it is only forwarded when `NODE_ENV !== 'production'`, so CSRF protection cannot be accidentally disabled in a production deployment.

- f9654df: Security and correctness fixes:

    - API key ids are now random and no longer expose a prefix of the secret key.
    - CSRF tokens are HMAC-signed (signed double-submit cookie) and compared in constant time; forged, tampered, and unsigned tokens are rejected.
    - `/health/ready` now runs readiness checks registered via `addReadinessCheck()` and returns 503 when any fails, instead of always reporting ready.

- Updated dependencies [f9654df]
- Updated dependencies
- Updated dependencies [f9654df]
- Updated dependencies
- Updated dependencies
- Updated dependencies [f9654df]
- Updated dependencies [f9654df]
- Updated dependencies [f9654df]
- Updated dependencies
    - @iskra-bun/auth-kit@0.1.0
    - @iskra-bun/core@0.1.1
    - @iskra-bun/mailer-kit@0.1.0
    - @iskra-bun/storage-kit@0.1.0

## 0.1.0

### Minor Changes

- Initial public release.
