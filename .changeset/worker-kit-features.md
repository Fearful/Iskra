---
"@iskra-bun/worker-kit": minor
---

New worker features:

- Scheduled/repeat jobs: a `repeat` option on `JobOptions` plus a `schedule(name, data, repeat, opts?)` convenience for cron/interval jobs.
- Dead-letter handling: opt-in `deadLetter` emits a `worker:dead-letter` event with the job and `failedReason` once retries are exhausted.
- Job results: handlers may return a value (`JobHandler<T, R>`); the enqueue descriptor exposes a `result()` helper backed by BullMQ `QueueEvents`.
