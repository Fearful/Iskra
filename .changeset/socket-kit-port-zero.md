---
"@iskra-bun/socket-kit": patch
---

`port: 0` now picks a free port instead of silently listening on 3001 (the option was read with `||`), and a port that is not an integer (`NaN` from `Number(process.env.PORT)` with `PORT` unset) uses 3001 instead of a random port. The start log reports the port the server listens on. The new `driver.port` getter returns the port the server listens on once started, or the configured one before.
