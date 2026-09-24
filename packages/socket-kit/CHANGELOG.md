# @iskra-bun/socket-kit

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
