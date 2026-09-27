---
"@iskra-bun/core": patch
---

A driver whose `init()` throws no longer leaves the drivers before it running: `app.init()`/`app.start()` stop, in reverse order, the drivers whose `init()` ran so far (the failing one too, it may hold part of what it opened; a driver without an `init` hook was never initialized and is left alone), shut down OpenTelemetry and rethrow. A driver that fails to start now makes `app.start()` stop every driver in reverse order, not only the ones already started: all of them were initialized and may hold connections or child processes, the failing one included. OpenTelemetry is shut down there too, and a later `app.stop()` stops nothing a second time.
