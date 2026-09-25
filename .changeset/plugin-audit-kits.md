---
"@iskra-bun/kv-kit": patch
"@iskra-bun/socket-kit": patch
"@iskra-bun/process-kit": minor
"create-iskra": patch
---

**Security** fixes from the plugin audit.

- `kv-kit`: Redis errors passed to `onError` (and so logged by `KVManager`) and the cause of a failed `connect()` keep only the command's name. ioredis attached its arguments, so a refused login logged the Redis password (`command.args` of AUTH), for example after a password rotation.
- `socket-kit`: `ctx.broadcast()` and `ctx.join()` refuse a room or topic that is not a string before calling `canPublish`/`canJoin`. A handler passing the client's value on could be given `["global"]`, which passes a deny-list such as `topic !== 'global'` and which Bun's `publish()` turns into `"global"`. The rate limiter logs one warning per connection and window instead of one per dropped frame (a flooding client wrote ~23 bytes of log per byte sent), and a frame that is not JSON is logged at debug level without a stack.
- `process-kit` (**breaking**): `send()` refuses a string with a line break, which the child read as several messages (send an object to have it JSON-encoded). After a stdout line longer than 1 MiB, the rest of that line is dropped instead of being read as a line of its own, which let text a child echoed come out as a JSON `process:message`. The spawn log line has the command and the number of arguments; the arguments, which can carry credentials, are logged at debug level.
- `create-iskra`: `scaffold()` only accepts the name of a bundled template (`../x` copied any directory into the new project), and `scripts/sync.ts` refuses symlinks in a template instead of copying their target into the published package.
