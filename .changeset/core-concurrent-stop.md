---
"@iskra-bun/core": patch
---

`app.stop()` called while a stop is in progress now returns that same stop, resolving once every driver has stopped. It used to find no started drivers and resolve at once, so an app's own `await app.stop(); process.exit(0)` signal handler exited while the App's handler was still stopping the drivers. The signal listeners stay installed until the stop finishes, so a second `SIGTERM`/`SIGINT` reaches the handler and exits with code 1 (it used to take the runtime's default action, exit code 130/143).
