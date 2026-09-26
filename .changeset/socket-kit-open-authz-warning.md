---
"@iskra-bun/socket-kit": patch
---

`start()` now also logs a warning when `canJoin` or `canPublish` is not set, naming what stays open: any client can join any room, or publish to any topic (`global` included). The start-up warning used to cover only a handshake without `allowedOrigins` or `authenticate`.
