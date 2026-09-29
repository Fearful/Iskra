# @iskra-bun/socket-kit

## 0.3.0

### Minor Changes

- b8d35b4: New `SocketDriver#close(connectionId, code?, reason?)` closes one connection by the id of `socket:connected` (false when it is not open). An app that authenticates in the first message had no way to close a connection that never did, and such a connection stayed open as long as its client answered pings; the docs show how to give each connection an authentication deadline, as the chat-app template now does.
- ada8d01: **Security:** WebSocket handshake hardening.

    - New `allowedOrigins` option: handshakes whose `Origin` is not listed are refused with 403, preventing cross-site WebSocket hijacking (a browser sends the user's cookies with the handshake).
    - New `authenticate(req)` hook: its return value is stored as `socket.data.auth`; `null`/`undefined`/`false` or a throw refuses the connection with 401.
    - The driver logs a warning at start when neither is configured.
    - Clients can no longer trigger the driver's own lifecycle events: a frame with `event: "connected"` or `"disconnected"` used to be re-emitted as `socket:connected` / `socket:disconnected` on the app bus.

### Patch Changes

- 840439a: Packages declare the runtime they are tested on: `engines.bun` `>=1.3.0` (the monorepo now builds and tests on Bun 1.3). `create-iskra`, a CLI that also runs under `npm create iskra`, declares `engines.node` `>=18`.

    Every package is published with an npm provenance attestation (`publishConfig.provenance`), linking each version to the commit and CI run that built it.

- cb3ec43: Register what each kit puts on the app with core's new registries: `app.context.get('db' | 'kv' | 'oracle')` returns the kit's driver, and the `process:*`, `socket:connected` / `socket:disconnected` and `worker:dead-letter` events have typed payloads. `ProcessManager.send()` takes `unknown` data.
- 9bb254d: **Security** fixes from the plugin audit.

    - `kv-kit`: Redis errors passed to `onError` (and so logged by `KVManager`) and the cause of a failed `connect()` keep only the command's name. ioredis attached its arguments, so a refused login logged the Redis password (`command.args` of AUTH), for example after a password rotation.
    - `socket-kit`: `ctx.broadcast()` and `ctx.join()` refuse a room or topic that is not a string before calling `canPublish`/`canJoin`. A handler passing the client's value on could be given `["global"]`, which passes a deny-list such as `topic !== 'global'` and which Bun's `publish()` turns into `"global"`. The rate limiter logs one warning per connection and window instead of one per dropped frame (a flooding client wrote ~23 bytes of log per byte sent), and a frame that is not JSON is logged at debug level without a stack.
    - `process-kit` (**breaking**): `send()` refuses a string with a line break, which the child read as several messages (send an object to have it JSON-encoded). After a stdout line longer than 1 MiB, the rest of that line is dropped instead of being read as a line of its own, which let text a child echoed come out as a JSON `process:message`. The spawn log line has the command and the number of arguments; the arguments, which can carry credentials, are logged at debug level.
    - `create-iskra`: `scaffold()` only accepts the name of a bundled template (`../x` copied any directory into the new project), and `scripts/sync.ts` refuses symlinks in a template instead of copying their target into the published package.

- 8bed5c4: `start()` now also logs a warning when `canJoin` or `canPublish` is not set, naming what stays open: any client can join any room, or publish to any topic (`global` included). The start-up warning used to cover only a handshake without `allowedOrigins` or `authenticate`.
- d2a232f: A request to the socket port that is not a WebSocket handshake (a plain `GET` from a browser or a load balancer's health check) gets `426 Upgrade Required` with `Upgrade: websocket`, instead of `500 Upgrade failed`, which health checks read as the service being down.
- 3afb48b: `port: 0` now picks a free port instead of silently listening on 3001 (the option was read with `||`), and a port that is not an integer (`NaN` from `Number(process.env.PORT)` with `PORT` unset) uses 3001 instead of a random port. The start log reports the port the server listens on. The new `driver.port` getter returns the port the server listens on once started, or the configured one before.
- ee559ec: - A message whose `event` is not a string is ignored. `{"event":["disconnected"]}` passed the reserved-name check and then stringified to `socket:disconnected`, so any client could fire the app's disconnect/presence handlers.
    - `stop()` closes open connections (with a close frame, reason "Server shutting down") and the listener. It only stopped accepting new ones: connected clients kept being served after `app.stop()`, by handlers whose other drivers were already stopped.
    - Falsy payloads (`0`, `false`, `""`) reach handlers unchanged; a missing payload is still `{}`.
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

- f9654df: New socket features:

    - Rooms: `join(room)`/`leave(room)` on the socket context and `broadcastTo(room, event, payload)` on the driver (native Bun pub/sub topics). The existing global `broadcast()` is unchanged.
    - A `socket:disconnected` event is emitted on close, as a counterpart to `socket:connected`.
    - Each connection gets a stable unique `connectionId` (assigned at upgrade, stored on the typed socket data) included in the connected/disconnected payloads, so per-client tracking no longer relies on the non-unique remote address.

### Patch Changes

- f9654df: The running server is now typed with Bun's `Server` instead of `any`, and `SocketContext`/`SocketHandler` accept optional payload/connection-data generics so handlers can read a typed `socket.data`. Defaults preserve existing usage.
- Add authorization and payload hardening to the socket driver:

    - `canJoin` and `canPublish` hooks now gate room joins and publishes, so unauthorized clients can no longer subscribe to or broadcast on topics they are not permitted to use.
    - `ctx.broadcast` wraps outgoing data in a consistent `{ event, payload }` envelope.
    - `websocket.maxPayloadLength` is wired through (default 16 KiB) alongside a per-connection rate limit and an `allowedEvents` fallback gate, mitigating oversized-message and message-flood denial-of-service.

- Updated dependencies [f9654df]
- Updated dependencies
- Updated dependencies [f9654df]
    - @iskra-bun/core@0.1.1

## 0.1.0

### Minor Changes

- Initial public release.
