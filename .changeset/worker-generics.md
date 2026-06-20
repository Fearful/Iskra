---
"@iskra-bun/worker-kit": patch
---

`register`, `enqueue`, and `JobHandler` are now generic over the job payload type, so a handler's `job.data` and the enqueued payload are typed instead of `any`. Defaults to `unknown`, so existing call sites compile unchanged.
