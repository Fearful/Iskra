---
"@iskra-bun/db-oracle": patch
---

When the bridge process exits while the app runs, the driver logs an error and later queries reject at once. It used to keep the dead process, so every later query waited for its timeout (30 s by default) before failing. A bridge that exits right after reporting ready now fails `start()` instead of leaving it in that state.
