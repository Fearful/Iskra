---
"@iskra-bun/worker-kit": patch
---

Per-job options no longer erase `defaultJobOptions`: every unset option was passed to BullMQ as `undefined`, which overrides the queue default, so a job enqueued with just `{ priority }` or `{ delay }`, and every job from `schedule()`, lost its `attempts`, `backoff` and `removeOnComplete`/`removeOnFail` (no retries, and completed repeat jobs kept in Redis forever). IPv6 Redis URLs (`redis://[::1]:6379`) now connect: the host kept its brackets.
