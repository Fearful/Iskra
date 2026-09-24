---
"@iskra-bun/db-oracle": minor
---

Fix: the published package could never start. `files` did not include `bridge/`, so the default `bridge/runner.js` the driver spawns was missing, and `oracledb` (required by the bridge) was declared nowhere.

- Ship `bridge/runner.js` and `bridge/package.json`; `oracledb` is now a peer dependency.
- `start()` waits for the bridge to connect and rejects with Oracle's error (bad connect string, unreachable host, bridge exiting early, or no `ready` within `startTimeoutMs`, a new third constructor argument) instead of reporting success and failing every later query. A missing bridge script fails with a clear message.
- `stop()` closes the bridge's stdin so it can close the Oracle connection, killing it only if it does not exit.
- Each bridge process keeps its own pending-request map, so the previous bridge shutting down can no longer reject queries sent after a restart.
- **Breaking:** the driver's `name` is now `"OracleDriver"` (it was `"db"`, the same as db-kit's `DbDriver`).
