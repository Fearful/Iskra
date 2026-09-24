# @iskra-bun/worker-kit

## 0.2.0

### Minor Changes

- f9654df: New worker features:

    - Scheduled/repeat jobs: a `repeat` option on `JobOptions` plus a `schedule(name, data, repeat, opts?)` convenience for cron/interval jobs.
    - Dead-letter handling: opt-in `deadLetter` emits a `worker:dead-letter` event with the job and `failedReason` once retries are exhausted.
    - Job results: handlers may return a value (`JobHandler<T, R>`); the enqueue descriptor exposes a `result()` helper backed by BullMQ `QueueEvents`.

### Patch Changes

- f9654df: `register`, `enqueue`, and `JobHandler` are now generic over the job payload type, so a handler's `job.data` and the enqueued payload are typed instead of `any`. Defaults to `unknown`, so existing call sites compile unchanged.
- f9654df: `stop()` now drains in-flight jobs by fully closing the worker before closing the queue, instead of closing both concurrently (which could leave a running job stuck in the `active` state).
- Fix a connection leak after `stop()`. `stop()` now sets the stopped flag first, and `getQueueEvents()` throws `WorkerManager is stopped; cannot open QueueEvents` rather than lazily opening a new orphaned connection. Job descriptors created after stop reject instead of silently holding an open connection.
- Updated dependencies [f9654df]
- Updated dependencies
- Updated dependencies [f9654df]
    - @iskra-bun/core@0.1.1

## 0.1.0

### Minor Changes

- Initial public release.
