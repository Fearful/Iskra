---
"@iskra-bun/socket-kit": patch
---

`port: 0` now picks a free port instead of silently listening on 3001 (the option was read with `||`). The new `driver.port` getter returns the port the server listens on once started, or the configured one before.
