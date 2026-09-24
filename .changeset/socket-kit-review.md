---
"@iskra-bun/socket-kit": patch
---

- A message whose `event` is not a string is ignored. `{"event":["disconnected"]}` passed the reserved-name check and then stringified to `socket:disconnected`, so any client could fire the app's disconnect/presence handlers.
- `stop()` closes open connections (with a close frame, reason "Server shutting down") and the listener. It only stopped accepting new ones: connected clients kept being served after `app.stop()`, by handlers whose other drivers were already stopped.
- Falsy payloads (`0`, `false`, `""`) reach handlers unchanged; a missing payload is still `{}`.
