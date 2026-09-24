---
"@iskra-bun/kv-kit": patch
---

`RedisAdapter.disconnect()` (and so `KVManager.stop()`) no longer waits for Redis's reconnect attempts when the server is down: the client is closed at once. ioredis queued `QUIT` behind the pending commands, so it took about 10 s (never returned with `maxRetriesPerRequest: null`) and used up the app's shutdown timeout. When connected, `QUIT` is given at most 2 s.
