---
"@iskra-bun/socket-kit": minor
---

**Security:** WebSocket handshake hardening.

- New `allowedOrigins` option: handshakes whose `Origin` is not listed are refused with 403, preventing cross-site WebSocket hijacking (a browser sends the user's cookies with the handshake).
- New `authenticate(req)` hook: its return value is stored as `socket.data.auth`; `null`/`undefined`/`false` or a throw refuses the connection with 401.
- The driver logs a warning at start when neither is configured.
- Clients can no longer trigger the driver's own lifecycle events: a frame with `event: "connected"` or `"disconnected"` used to be re-emitted as `socket:connected` / `socket:disconnected` on the app bus.
