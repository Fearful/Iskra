# @iskra-bun/process-kit

## 0.3.1

### Patch Changes

- Updated dependencies [e86ed55]
- Updated dependencies [ae7c798]
- Updated dependencies [ef10372]
    - @iskra-bun/core@0.3.0

## 0.3.0

### Minor Changes

- 9bb254d: **Security** fixes from the plugin audit.

    - `kv-kit`: Redis errors passed to `onError` (and so logged by `KVManager`) and the cause of a failed `connect()` keep only the command's name. ioredis attached its arguments, so a refused login logged the Redis password (`command.args` of AUTH), for example after a password rotation.
    - `socket-kit`: `ctx.broadcast()` and `ctx.join()` refuse a room or topic that is not a string before calling `canPublish`/`canJoin`. A handler passing the client's value on could be given `["global"]`, which passes a deny-list such as `topic !== 'global'` and which Bun's `publish()` turns into `"global"`. The rate limiter logs one warning per connection and window instead of one per dropped frame (a flooding client wrote ~23 bytes of log per byte sent), and a frame that is not JSON is logged at debug level without a stack.
    - `process-kit` (**breaking**): `send()` refuses a string with a line break, which the child read as several messages (send an object to have it JSON-encoded). After a stdout line longer than 1 MiB, the rest of that line is dropped instead of being read as a line of its own, which let text a child echoed come out as a JSON `process:message`. The spawn log line has the command and the number of arguments; the arguments, which can carry credentials, are logged at debug level.
    - `create-iskra`: `scaffold()` only accepts the name of a bundled template (`../x` copied any directory into the new project), and `scripts/sync.ts` refuses symlinks in a template instead of copying their target into the published package.

- 509c28c: **Breaking (0.x):** `ProcessManager#spawn()` rejects when the manager cannot start the process: before its App has initialized it (`ProcessManager is not initialized: register it on an App first`) and after `stop()` (`ProcessManager is stopped`). It used to resolve without starting anything, so the caller believed the process was running.
- 4504a53: Supervision fixes.

    - Children are spawned as process-group leaders and signals go to the whole group, so `kill()`/`stop()` also terminate the children of wrappers (`sh -c`, `npm run`, shell scripts), which used to be orphaned.
    - A late exit from an older instance with the same name (after `kill()`+`spawn()` or a restart) no longer removes or restarts the current one.
    - Restarts waiting out their backoff are tracked: `kill()` during the backoff cancels the restart (it used to throw "not found" while the timer respawned the process anyway), and `stop()` cancels them all.
    - `start()` works again after `stop()`.
    - **Behavior change:** `restartOnCrash` only restarts on a crash (non-zero exit code or death by signal); a clean exit with code 0 is not restarted. `process:exit` is now emitted for every mode as `{ name, exitCode, signal }`, with `exitCode: null` for signal deaths (previously reported as 0).
    - `process:error` is emitted once per stderr line instead of per arbitrary chunk; the last stdout/stderr line is emitted even without a trailing newline, and line buffers are capped at 1 MiB.

- 3579944: **Security:** runtime hardening from the second audit round.

    - `process-kit` (**breaking**): a child no longer inherits the app's whole environment. It gets the variables programs need and that carry no secrets (`PATH`, `HOME`, `USER`, `SHELL`, `TERM`, the locale, `TZ`, the temp dir, `NODE_ENV`, and the Windows essentials), plus `env`: `DATABASE_URL`, `AUTH_SECRET`, cloud keys and whatever was loaded from `.env` reached every child, third-party code included. The new `inheritEnv` option (validated by the core config schema, as is `maxPendingStdinBytes`) takes more names to pass, or `true` for all of them as before.
    - `process-kit`: `send()` refuses a message, with one warning until the child catches up, when the bytes still waiting for a child that is not reading its stdin would go over `maxPendingStdinBytes` (8 MiB by default). They piled up in the app's memory without a bound: 256 MiB sent to such a child grew RSS by 263 MiB. `send()` now resolves to whether the message was sent (`false` for every refusal).
    - `core`: OpenTelemetry. The options of each entry of `otel.instrumentations` reach the instrumentation (the config schema kept only `enabled`, so hooks and `redactedQueryParams` were dropped). HTTP spans export URLs with the values of secret-looking query parameters (`SECRET_QUERY_PARAMS`: `token`, `access_token`, `api_key`, `key`, `code`, `state`, `sig`, `X-Amz-Signature`…) replaced by `REDACTED`, through instrumentation-http's `redactedQueryParams` / `redactedQueryParamsServer` (which the app can set) and a `requestHook` for releases without them; the app's own `requestHook` still runs. The startup log shows only the endpoint's origin (its path, query or password can be an API key), and a plain `http://` endpoint on a remote host logs a warning. New exports: `SECRET_QUERY_PARAMS`, `redactUrl()`, `autoInstrumentationOptions()`, `describeOtelEndpoint()`.
    - `web-kit`: `OtelTracingFeature` exported `url.full` as requested (@hono/otel sets it to `c.req.url`): the `?token=` of an email verification link, the token of better-auth's `/reset-password/<token>` and `?api_key=` reached the collector. The values of `SECRET_QUERY_PARAMS` (or the new `redactedQueryParams`) and that path token are now `REDACTED`. New `ignoreIncomingTraceContext` option to start a new trace per request instead of continuing the client's `traceparent` (default unchanged). `@opentelemetry/api` is now a direct dependency (it already came with `@hono/otel`).
    - `web-kit`: `OpenAPIFeature`'s `/docs` page loaded `@scalar/api-reference@latest` on the app's origin. It now loads a pinned release (1.68.0) with its SRI hash and `crossorigin`, sends a Content-Security-Policy (scripts from that host only; requests only to the app and the spec's `servers`), turns off Scalar's web fonts and AI agent (which sends the spec to Scalar's servers), and HTML-escapes the title. New options: `docs: false` serves neither `/openapi.json` nor `/docs`; `authorize(c)` gates both (they are registered before middleware added after `initialize()`, so a `basicAuth()` there did not cover them); `scalar: { src, integrity }` or `false`.
    - `web-kit` (**breaking**): `HealthCheckFeature`'s `/health/ready` lists the check names (`checks`, `failed`) and `/health/live` the `uptime` only with `includeDetails: true`, like `/health`; the names of failed readiness checks are logged instead.
    - `worker-kit` (**breaking**): finished jobs are no longer kept in Redis forever with their payloads (BullMQ's default when `removeOnComplete`/`removeOnFail` are unset, which worker-kit never set). The queue keeps the last 1000 completed jobs and the failed ones of the last 7 days (at most 5000); `defaultJobOptions` or a job's options override it (`false` keeps them all), and both options now take BullMQ's `{ age, count }` form. `result()` of a job removed since rejects. The dead-letter example in the docs logged the whole payload with `console.error`, outside the logger's redaction; it logs ids now.

### Patch Changes

- 840439a: Packages declare the runtime they are tested on: `engines.bun` `>=1.3.0` (the monorepo now builds and tests on Bun 1.3). `create-iskra`, a CLI that also runs under `npm create iskra`, declares `engines.node` `>=18`.

    Every package is published with an npm provenance attestation (`publishConfig.provenance`), linking each version to the commit and CI run that built it.

- cb3ec43: Register what each kit puts on the app with core's new registries: `app.context.get('db' | 'kv' | 'oracle')` returns the kit's driver, and the `process:*`, `socket:connected` / `socket:disconnected` and `worker:dead-letter` events have typed payloads. `ProcessManager.send()` takes `unknown` data.
- 87f6de2: `KVManager` throws when its constructor gets `adapter`, `driver` or `connection`: the store is chosen by the App config (`kv: { driver, connection }`), and the README's `new KVManager({ adapter: 'redis' })` was silently ignored, leaving the app on per-process memory. Without a `kv` driver it now logs a warning in production instead of an info line. The READMEs of kv-kit, worker-kit (`connection` and `queueName`, not `queue`), db-kit (the App's `db` config) and process-kit (the App's `processes` config) show working examples.
- 620da18: Children no longer outlive the app when it exits before `stop()` is done with them (the App's `shutdownTimeoutMs`, a second signal, or any `process.exit()`): the process groups still running are sent SIGKILL on exit. Since each child runs in its own process group, neither the terminal's Ctrl-C nor the parent's death reached them, and they were left running under init.
- 897abae: A crashed process is restarted only once the children it left behind have exited, as the docs say. Terminating them was not awaited, so a restart whose backoff was shorter than their exit ran next to them (holding the same port, say). The pending restart stays cancellable by `kill()` and `stop()` while it waits, and `stop()` waits for those children to be gone too.
- 582d47d: `kill()` and `stop()` now wait for the whole process group, and SIGKILL it when anything in it is still alive after the graceful timeout: a grandchild that ignored SIGTERM used to outlive a wrapper that exited on it. A crashed process's leftover children are terminated before it is restarted, instead of piling up with every restart. `stop()` no longer leaves a timer that kept the event loop alive for twice the timeout. `send()` to a process that closed its stdin logs the broken pipe instead of raising an unhandled rejection. `spawn()` rejects when the command cannot be spawned; at `app.start()` and on a restart that failure is emitted as `process:spawn-error` and retried with the restart backoff instead of silently ending supervision.
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

- f9654df: New process-management features:

    - `spawn(name, config)` and `kill(name)` to add or gracefully remove individual processes at runtime, instead of only at boot.
    - Configurable exponential restart backoff (`restartBackoff: { initialMs, maxMs, factor }` on `ProcessConfig`) replacing the fixed 1s restart delay, so a crash-looping process backs off instead of hammering a broken dependency. Defaults to the previous 1s when unset.

### Patch Changes

- f9654df: `stop()` now shuts processes down gracefully — SIGTERM, wait for exit with a configurable timeout, then SIGKILL — and awaits exit before clearing state. `oneshot` mode is now implemented: the process runs to completion once and is never restarted, even when `restartOnCrash` is set.
- `terminate()` now detects orphaned processes: when a process survives both SIGTERM and SIGKILL, it logs an error (`survived SIGTERM and SIGKILL and is now an orphan`) via `app.logger` instead of failing silently. This is shared by `kill()` and `stop()`; a process that exits cleanly does not log.
- Updated dependencies [f9654df]
- Updated dependencies
- Updated dependencies [f9654df]
    - @iskra-bun/core@0.1.1

## 0.1.0

### Minor Changes

- Initial public release.
