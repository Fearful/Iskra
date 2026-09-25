---
"@iskra-bun/socket-kit": minor
---

New `SocketDriver#close(connectionId, code?, reason?)` closes one connection by the id of `socket:connected` (false when it is not open). An app that authenticates in the first message had no way to close a connection that never did, and such a connection stayed open as long as its client answered pings; the docs show how to give each connection an authentication deadline, as the chat-app template now does.
