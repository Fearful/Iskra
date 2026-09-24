---
"@iskra-bun/core": patch
---

Outside `NODE_ENV=production` the logger now uses `pino-pretty` as an in-process stream instead of a pino `transport`. The transport runs in a worker thread that loads `pino-pretty` by name at runtime, so an app compiled with `bun build --compile` crashed on start ("unable to determine transport target for pino-pretty", or the worker failing to load its dependencies) unless `NODE_ENV=production` was set.
