---
"@iskra-bun/worker-kit": minor
---

Handlers get a second argument, `{ signal }`: BullMQ's signal for the job, aborted when it is cancelled (`worker.cancelJob`), as in scheduler-kit, whose `JobScheduler` type `WorkerManager` satisfies. Existing handlers keep working; a handler called directly (in a test) now needs the second argument at the type level, e.g. `{ signal: new AbortController().signal }`.
