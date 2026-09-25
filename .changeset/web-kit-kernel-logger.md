---
"@iskra-bun/web-kit": minor
---

The Kernel and its features log through a logger instead of writing to the console directly. `KernelConfig.logger` takes an object with `debug`/`info`/`warn`/`error(message, details?)`, or `false` for no output; the default is still the console. `WebPlugin` passes the App's logger unless `logger` is set, so web-kit's messages share the app's format, level and sinks, with errors as `{ err }`. Features get it with `kernel.getLogger()`. Each feature's startup message is now `debug` (so an app logging at `info` no longer prints one line per feature), and the "Registered feature" lines are gone. New exports: `KernelLogger`, `consoleLogger`, `silentLogger`, `fromStructuredLogger`. `ValidationOptions` and `JsonValidationOptions` accept a `logger`.
