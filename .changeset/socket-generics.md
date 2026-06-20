---
"@iskra-bun/socket-kit": patch
---

The running server is now typed with Bun's `Server` instead of `any`, and `SocketContext`/`SocketHandler` accept optional payload/connection-data generics so handlers can read a typed `socket.data`. Defaults preserve existing usage.
