---
"@iskra-bun/kv-kit": minor
---

`KVManager` registers itself in the app context as `'kv'` (as db-kit does with `'db'`) and exposes the underlying ioredis client as `client` (Redis driver, after `start()`; it bypasses `namespace` and the JSON codec) for commands the KV API does not cover, such as sets. forms-app's services read `app.context.get('kv').client`, which was always `undefined`, so they silently skipped every Redis read and write and no published form could be found.
