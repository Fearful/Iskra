# @iskra-bun/core

## 0.2.0

### Minor Changes

- 5b2b0fd: Lifecycle fixes and graceful shutdown.

    - `app.start()` starts drivers one at a time in registration order; if one fails, the drivers already started are stopped in reverse order before the error is rethrown (previously `Promise.all` left them running, with ports bound and child processes alive).
    - `app.stop()` stops drivers in reverse start order, continues past failures, and always shuts down OpenTelemetry (a failing driver used to skip the span/metric flush).
    - Async `plugin.install()` is awaited during `start()`, so its failure is reported instead of crashing the process as an unhandled rejection.
    - New: `SIGTERM`/`SIGINT` trigger a graceful `stop()` and exit (0, or 1 on failure/timeout). Configure with `shutdownSignals` (`false` to disable) and `shutdownTimeoutMs` (default 10000); disabled under `NODE_ENV=test`.

- cb3ec43: **Breaking (types):** no more `any` in core's public API.

    - `app.context` is an `AppContext` (a `Map`) typed through the `AppContextRegistry` interface: kits register their keys (`db`, `kv`, `oracle`), apps add theirs with declaration merging, and an unregistered key holds `unknown` (or the type given as `get<T>()`).
    - `app.on()` / `app.emit()` are typed through the `AppEvents` interface (kits declare their events); other events' payloads are `unknown`. `Context<T>` defaults to `unknown` and `reply()` takes `unknown`.
    - `AppConfig`'s extra sections are `unknown` (were `any`); `kv.connection` is `string | Record<string, unknown>`.
    - The optional OpenTelemetry modules are loaded through small typed interfaces; `createResource()` takes an `OtelResourcesModule` and returns `unknown`.

    See the "Upgrading to the typed APIs" guide.

- ef2009b: **Security:** update dependencies with known vulnerabilities (`bun audit` went from 67 findings, 1 critical and 38 high, to one accepted dev-only finding).

    - `better-auth` ^1.6.33 (account takeover via pre-account hijacking), `hono` ^4.12.34, `ajv` ^8.20.0, `mysql2` ^3.24.4 (web-kit, auth-kit, db-kit).
    - `drizzle-orm` ^0.45.2 (SQL injection via improperly escaped identifiers). **db-kit moves from 0.30 to 0.45**, the same line web-kit and auth-kit already used, so schemas are shared across kits again; `drizzle-kit` ^0.31.11 now matches it (0.30 exited with "requires newer version of drizzle-orm", so migrations never ran), and `@libsql/client` ^0.18.0 satisfies drizzle's peer range.
    - `c12` ^3.3.4 in core (drops the vulnerable `tar` 6 pulled in through `giget` 1).
    - `nodemailer` ^10.0.10 in mailer-kit (arbitrary file read / SSRF via the raw option, SMTP command and header injection).

- 9872d30: **Security:** the logger redaction every kit relies on, and config loading.

    - Errors are serialized and scrubbed like other objects (pino serialized them after the redaction ran): an HTTP client error's `config.headers.Authorization`, or a secret field of the error or of its causes, is censored.
    - The bindings of child loggers (`logger.child({ ... })`) are scrubbed too.
    - Keys are compared without case, `-` or `_`, and keys ending in `password`, `secret`, `token`, `apiKey`, `secretKey`, `privateKey` or `accessKey` are censored: `x-api-key`, `api_key`, `client_secret`, `access_token`, `set-cookie`, `DB_PASSWORD` and `AWS_SECRET_ACCESS_KEY` were written as they were. `proxyAuthorization`, `setCookie` and `sessionId` join the list.
    - Messages, and error messages and stacks, have the password of `scheme://user:password@host` URLs and secret-looking query parameters (`?authToken=`, `&X-Amz-Signature=`) masked.
    - **Breaking:** `loadAppConfig()` (used by `new App()` without a config) no longer reads `.apprc` files from the working directory, which could add `processes` to spawn or move `otel.endpoint`, and no longer downloads and runs `extends` layers from `github:`, `gitlab:` or `https://` sources on every start. Local `extends` paths still work.

- f2346f5: **Breaking behavior:** production safeguards now apply unless `NODE_ENV` is `development` or `test`. They applied only to `NODE_ENV=production` exactly, so a deploy that forgot it (or used `staging`) sent session cookies without `Secure`, accepted sample secrets and plain-http auth URLs, honored `disableCSRFCheck` and wrote pretty logs. `NODE_ENV` is also read when the app runs: `bun build` replaced a literal `process.env.NODE_ENV` with `"development"` when it was unset while building, so a compiled binary ignored the value it ran with. `app.start()` logs a warning when `NODE_ENV` is unset. Set `NODE_ENV=development` for local development; the templates' `bun dev` scripts do. New `nodeEnv()`, `isProductionEnv()` and `isDevelopmentEnv()` in `@iskra-bun/core`.
- 3579944: **Security:** runtime hardening from the second audit round.

    - `process-kit` (**breaking**): a child no longer inherits the app's whole environment. It gets the variables programs need and that carry no secrets (`PATH`, `HOME`, `USER`, `SHELL`, `TERM`, the locale, `TZ`, the temp dir, `NODE_ENV`, and the Windows essentials), plus `env`: `DATABASE_URL`, `AUTH_SECRET`, cloud keys and whatever was loaded from `.env` reached every child, third-party code included. The new `inheritEnv` option (validated by the core config schema, as is `maxPendingStdinBytes`) takes more names to pass, or `true` for all of them as before.
    - `process-kit`: `send()` refuses a message, with one warning until the child catches up, when the bytes still waiting for a child that is not reading its stdin would go over `maxPendingStdinBytes` (8 MiB by default). They piled up in the app's memory without a bound: 256 MiB sent to such a child grew RSS by 263 MiB. `send()` now resolves to whether the message was sent (`false` for every refusal).
    - `core`: OpenTelemetry. The options of each entry of `otel.instrumentations` reach the instrumentation (the config schema kept only `enabled`, so hooks and `redactedQueryParams` were dropped). HTTP spans export URLs with the values of secret-looking query parameters (`SECRET_QUERY_PARAMS`: `token`, `access_token`, `api_key`, `key`, `code`, `state`, `sig`, `X-Amz-Signature`…) replaced by `REDACTED`, through instrumentation-http's `redactedQueryParams` / `redactedQueryParamsServer` (which the app can set) and a `requestHook` for releases without them; the app's own `requestHook` still runs. The startup log shows only the endpoint's origin (its path, query or password can be an API key), and a plain `http://` endpoint on a remote host logs a warning. New exports: `SECRET_QUERY_PARAMS`, `redactUrl()`, `autoInstrumentationOptions()`, `describeOtelEndpoint()`.
    - `web-kit`: `OtelTracingFeature` exported `url.full` as requested (@hono/otel sets it to `c.req.url`): the `?token=` of an email verification link, the token of better-auth's `/reset-password/<token>` and `?api_key=` reached the collector. The values of `SECRET_QUERY_PARAMS` (or the new `redactedQueryParams`) and that path token are now `REDACTED`. New `ignoreIncomingTraceContext` option to start a new trace per request instead of continuing the client's `traceparent` (default unchanged). `@opentelemetry/api` is now a direct dependency (it already came with `@hono/otel`).
    - `web-kit`: `OpenAPIFeature`'s `/docs` page loaded `@scalar/api-reference@latest` on the app's origin. It now loads a pinned release (1.68.0) with its SRI hash and `crossorigin`, sends a Content-Security-Policy (scripts from that host only; requests only to the app and the spec's `servers`), turns off Scalar's web fonts and AI agent (which sends the spec to Scalar's servers), and HTML-escapes the title. New options: `docs: false` serves neither `/openapi.json` nor `/docs`; `authorize(c)` gates both (they are registered before middleware added after `initialize()`, so a `basicAuth()` there did not cover them); `scalar: { src, integrity }` or `false`.
    - `web-kit` (**breaking**): `HealthCheckFeature`'s `/health/ready` lists the check names (`checks`, `failed`) and `/health/live` the `uptime` only with `includeDetails: true`, like `/health`; the names of failed readiness checks are logged instead.
    - `worker-kit` (**breaking**): finished jobs are no longer kept in Redis forever with their payloads (BullMQ's default when `removeOnComplete`/`removeOnFail` are unset, which worker-kit never set). The queue keeps the last 1000 completed jobs and the failed ones of the last 7 days (at most 5000); `defaultJobOptions` or a job's options override it (`false` keeps them all), and both options now take BullMQ's `{ age, count }` form. `result()` of a job removed since rejects. The dead-letter example in the docs logged the whole payload with `console.error`, outside the logger's redaction; it logs ids now.

### Patch Changes

- 620da18: `app.stop()` called while a stop is in progress now returns that same stop, resolving once every driver has stopped. It used to find no started drivers and resolve at once, so an app's own `await app.stop(); process.exit(0)` signal handler exited while the App's handler was still stopping the drivers. The signal listeners stay installed until the stop finishes, so a second `SIGTERM`/`SIGINT` reaches the handler and exits with code 1 (it used to take the runtime's default action, exit code 130/143).
- b635a2c: Fix: `loadAppConfig()` no longer drops the `db`, `kv` and `socket` sections (or process `maxRestarts` / `restartCooldown` / `restartBackoff`, or any custom key) from `app.config.ts`. The schema was a plain `z.object()`, which strips unknown keys, so `new App()` without an explicit config left `DbDriver` with "No DB configuration found" and `KVManager` silently on the memory adapter. Sections are now validated for shape and unknown keys are kept, matching `AppConfig`'s `[key: string]: any`.
- 58d4a8f: Outside `NODE_ENV=production` the logger now uses `pino-pretty` as an in-process stream instead of a pino `transport`. The transport runs in a worker thread that loads `pino-pretty` by name at runtime, so an app compiled with `bun build --compile` crashed on start ("unable to determine transport target for pino-pretty", or the worker failing to load its dependencies) unless `NODE_ENV=production` was set.
- 5c70c5b: The logger censors sensitive fields at any depth of plain objects and arrays (`db.connection.password`, a top-level `authToken`, `authorization` and `cookie` headers…), not only at the top level and one level down, and without modifying the object passed. It is also faster than the previous path list. The README example no longer listens to an `app:started` event that is never emitted.
- ec198d4: A driver whose `init()` throws no longer leaves the drivers before it running: `app.init()`/`app.start()` stop, in reverse order, the drivers whose `init()` ran so far (the failing one too, it may hold part of what it opened; a driver without an `init` hook was never initialized and is left alone), shut down OpenTelemetry and rethrow. A driver that fails to start now makes `app.start()` stop every driver in reverse order, not only the ones already started: all of them were initialized and may hold connections or child processes, the failing one included. OpenTelemetry is shut down there too, and a later `app.stop()` stops nothing a second time.
- 840439a: Packages declare the runtime they are tested on: `engines.bun` `>=1.3.0` (the monorepo now builds and tests on Bun 1.3). `create-iskra`, a CLI that also runs under `npm create iskra`, declares `engines.node` `>=18`.

    Every package is published with an npm provenance attestation (`publishConfig.provenance`), linking each version to the commit and CI run that built it.

- dbf8817: Redis connection fixes for kv-kit (also used by cache-kit's `RedisAdapter`).

    - `connection: { url }`, as shown in the docs, was ignored by ioredis, so the adapter silently connected to `localhost:6379` db 0. The URL is now honored; a plain URL string or regular ioredis options also work.
    - Fractional TTLs (e.g. `0.5`) use `PX` instead of failing on Redis `EX`, and `mset` reports errors from individual pipelined commands instead of ignoring them.
    - `disconnect()` uses `QUIT`, so in-flight writes are not dropped.
    - **Breaking:** operations before `connect()` now throw instead of silently doing nothing, and an unsupported `kv.driver` (such as `"libsql"`, which never had an adapter and fell back to memory) now throws at `init()`. `AppConfig.kv.driver` is `"memory" | "redis"`.

- 3dc5581: Fix: `initOtel()` failed with "undefined is not a constructor" on current OpenTelemetry releases. `@opentelemetry/resources` 2.x only exports `resourceFromAttributes()` (the `Resource` class became a type), and the peer range (`>=1.20.0`) allowed it. The resource is now built with whichever API is installed (new `createResource` helper), verified end to end with `@opentelemetry/sdk-node` 0.222 / resources 2.11 exporting a span to an OTLP endpoint; 1.x keeps working.

## 0.1.1

### Patch Changes

- f9654df: `createLogger` now enables `pino-pretty` only when `NODE_ENV !== 'production'`. In production it emits structured JSON with no transport, so logs pipe cleanly to aggregators and containers.
- `createLogger` now redacts sensitive fields from log output. Keys such as `password`, `pass`, `apiKey`, `token` and `secret` (including nested occurrences), along with `config.env` and `*.data`, are replaced with `[REDACTED]` in both development and production, so credentials and config no longer leak into logs.
- f9654df: New process-management features:

    - `spawn(name, config)` and `kill(name)` to add or gracefully remove individual processes at runtime, instead of only at boot.
    - Configurable exponential restart backoff (`restartBackoff: { initialMs, maxMs, factor }` on `ProcessConfig`) replacing the fixed 1s restart delay, so a crash-looping process backs off instead of hammering a broken dependency. Defaults to the previous 1s when unset.

## 0.1.0

### Minor Changes

- Initial public release.
