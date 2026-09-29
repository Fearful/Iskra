# @iskra-bun/worker-kit

## 0.3.0

### Minor Changes

- 3579944: **Security:** runtime hardening from the second audit round.

    - `process-kit` (**breaking**): a child no longer inherits the app's whole environment. It gets the variables programs need and that carry no secrets (`PATH`, `HOME`, `USER`, `SHELL`, `TERM`, the locale, `TZ`, the temp dir, `NODE_ENV`, and the Windows essentials), plus `env`: `DATABASE_URL`, `AUTH_SECRET`, cloud keys and whatever was loaded from `.env` reached every child, third-party code included. The new `inheritEnv` option (validated by the core config schema, as is `maxPendingStdinBytes`) takes more names to pass, or `true` for all of them as before.
    - `process-kit`: `send()` refuses a message, with one warning until the child catches up, when the bytes still waiting for a child that is not reading its stdin would go over `maxPendingStdinBytes` (8 MiB by default). They piled up in the app's memory without a bound: 256 MiB sent to such a child grew RSS by 263 MiB. `send()` now resolves to whether the message was sent (`false` for every refusal).
    - `core`: OpenTelemetry. The options of each entry of `otel.instrumentations` reach the instrumentation (the config schema kept only `enabled`, so hooks and `redactedQueryParams` were dropped). HTTP spans export URLs with the values of secret-looking query parameters (`SECRET_QUERY_PARAMS`: `token`, `access_token`, `api_key`, `key`, `code`, `state`, `sig`, `X-Amz-Signature`…) replaced by `REDACTED`, through instrumentation-http's `redactedQueryParams` / `redactedQueryParamsServer` (which the app can set) and a `requestHook` for releases without them; the app's own `requestHook` still runs. The startup log shows only the endpoint's origin (its path, query or password can be an API key), and a plain `http://` endpoint on a remote host logs a warning. New exports: `SECRET_QUERY_PARAMS`, `redactUrl()`, `autoInstrumentationOptions()`, `describeOtelEndpoint()`.
    - `web-kit`: `OtelTracingFeature` exported `url.full` as requested (@hono/otel sets it to `c.req.url`): the `?token=` of an email verification link, the token of better-auth's `/reset-password/<token>` and `?api_key=` reached the collector. The values of `SECRET_QUERY_PARAMS` (or the new `redactedQueryParams`) and that path token are now `REDACTED`. New `ignoreIncomingTraceContext` option to start a new trace per request instead of continuing the client's `traceparent` (default unchanged). `@opentelemetry/api` is now a direct dependency (it already came with `@hono/otel`).
    - `web-kit`: `OpenAPIFeature`'s `/docs` page loaded `@scalar/api-reference@latest` on the app's origin. It now loads a pinned release (1.68.0) with its SRI hash and `crossorigin`, sends a Content-Security-Policy (scripts from that host only; requests only to the app and the spec's `servers`), turns off Scalar's web fonts and AI agent (which sends the spec to Scalar's servers), and HTML-escapes the title. New options: `docs: false` serves neither `/openapi.json` nor `/docs`; `authorize(c)` gates both (they are registered before middleware added after `initialize()`, so a `basicAuth()` there did not cover them); `scalar: { src, integrity }` or `false`.
    - `web-kit` (**breaking**): `HealthCheckFeature`'s `/health/ready` lists the check names (`checks`, `failed`) and `/health/live` the `uptime` only with `includeDetails: true`, like `/health`; the names of failed readiness checks are logged instead.
    - `worker-kit` (**breaking**): finished jobs are no longer kept in Redis forever with their payloads (BullMQ's default when `removeOnComplete`/`removeOnFail` are unset, which worker-kit never set). The queue keeps the last 1000 completed jobs and the failed ones of the last 7 days (at most 5000); `defaultJobOptions` or a job's options override it (`false` keeps them all), and both options now take BullMQ's `{ age, count }` form. `result()` of a job removed since rejects. The dead-letter example in the docs logged the whole payload with `console.error`, outside the logger's redaction; it logs ids now.

- fd36d6d: Job routing and connection fixes.

    - A job with no registered handler used to be marked **completed** (the worker returned early), so it silently disappeared. It now fails with BullMQ's `UnrecoverableError` (no pointless retries), stays in the failed set, and is dead-lettered when `deadLetter` is on.
    - New `consume: false` option for producer-only processes (e.g. an API node): `start()` creates no `Worker`, and `enqueue` accepts jobs whose handler lives in another process. Previously every producer had to register the handler and therefore also consume jobs.
    - Redis URLs keep the ACL username, percent-decode credentials, and `rediss://` enables TLS.
    - BullMQ queue/worker connection errors go to the app logger instead of the console.

### Patch Changes

- 840439a: Packages declare the runtime they are tested on: `engines.bun` `>=1.3.0` (the monorepo now builds and tests on Bun 1.3). `create-iskra`, a CLI that also runs under `npm create iskra`, declares `engines.node` `>=18`.

    Every package is published with an npm provenance attestation (`publishConfig.provenance`), linking each version to the commit and CI run that built it.

- cb3ec43: Register what each kit puts on the app with core's new registries: `app.context.get('db' | 'kv' | 'oracle')` returns the kit's driver, and the `process:*`, `socket:connected` / `socket:disconnected` and `worker:dead-letter` events have typed payloads. `ProcessManager.send()` takes `unknown` data.
- 87f6de2: `KVManager` throws when its constructor gets `adapter`, `driver` or `connection`: the store is chosen by the App config (`kv: { driver, connection }`), and the README's `new KVManager({ adapter: 'redis' })` was silently ignored, leaving the app on per-process memory. Without a `kv` driver it now logs a warning in production instead of an info line. The READMEs of kv-kit, worker-kit (`connection` and `queueName`, not `queue`), db-kit (the App's `db` config) and process-kit (the App's `processes` config) show working examples.
- 58d4a8f: `concurrency: 0` now means producer-only, like `consume: false`. It used to fall back to a concurrency of 1, so a service that set it to only enqueue (forms-app's forms-api did) also consumed jobs from the queue it had no handler for, and those jobs were lost.
- ee559ec: Per-job options no longer erase `defaultJobOptions`: every unset option was passed to BullMQ as `undefined`, which overrides the queue default, so a job enqueued with just `{ priority }` or `{ delay }`, and every job from `schedule()`, lost its `attempts`, `backoff` and `removeOnComplete`/`removeOnFail` (no retries, and completed repeat jobs kept in Redis forever). IPv6 Redis URLs (`redis://[::1]:6379`) now connect: the host kept its brackets.
- fba319a: A job whose handler throws is logged once at error level ("Job failed", now with `attemptsMade`) instead of twice: the processor also logged a `JobError` at error level before BullMQ's `failed` event logged it again. That processor log is now debug.
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

- f9654df: New worker features:

    - Scheduled/repeat jobs: a `repeat` option on `JobOptions` plus a `schedule(name, data, repeat, opts?)` convenience for cron/interval jobs.
    - Dead-letter handling: opt-in `deadLetter` emits a `worker:dead-letter` event with the job and `failedReason` once retries are exhausted.
    - Job results: handlers may return a value (`JobHandler<T, R>`); the enqueue descriptor exposes a `result()` helper backed by BullMQ `QueueEvents`.

### Patch Changes

- f9654df: `register`, `enqueue`, and `JobHandler` are now generic over the job payload type, so a handler's `job.data` and the enqueued payload are typed instead of `any`. Defaults to `unknown`, so existing call sites compile unchanged.
- f9654df: `stop()` now drains in-flight jobs by fully closing the worker before closing the queue, instead of closing both concurrently (which could leave a running job stuck in the `active` state).
- Fix a connection leak after `stop()`. `stop()` now sets the stopped flag first, and `getQueueEvents()` throws `WorkerManager is stopped; cannot open QueueEvents` rather than lazily opening a new orphaned connection. Job descriptors created after stop reject instead of silently holding an open connection.
- Updated dependencies [f9654df]
- Updated dependencies
- Updated dependencies [f9654df]
    - @iskra-bun/core@0.1.1

## 0.1.0

### Minor Changes

- Initial public release.
