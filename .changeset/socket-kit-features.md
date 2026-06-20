---
"@iskra-bun/socket-kit": minor
---

New socket features:

- Rooms: `join(room)`/`leave(room)` on the socket context and `broadcastTo(room, event, payload)` on the driver (native Bun pub/sub topics). The existing global `broadcast()` is unchanged.
- A `socket:disconnected` event is emitted on close, as a counterpart to `socket:connected`.
- Each connection gets a stable unique `connectionId` (assigned at upgrade, stored on the typed socket data) included in the connected/disconnected payloads, so per-client tracking no longer relies on the non-unique remote address.
