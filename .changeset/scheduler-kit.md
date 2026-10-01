---
"@iskra-bun/scheduler-kit": minor
---

New kit for periodic jobs in the app's own process, without Redis. `IntervalScheduler` is a driver with worker-kit's `register()` and `schedule(name, data, { every, limit? }, { runOnStart?, timeoutMs? })`: a tick that finds the previous run still going is skipped, a run that throws is logged and the schedule goes on, each run's `signal` is aborted after `timeoutMs` (a run past it fails, whatever it returns later) and on `stop()`, which then waits for the runs up to `shutdownTimeoutMs`. `status()` gives each job's counters, last run (with its result) and last error; `healthCheck(name, { maxConsecutiveFailures, maxStalenessMs, includeResult })` is a check for `HealthCheckFeature` that keeps the error's message out of the response, and `readinessCheck()` one for `/health/ready`. `JobScheduler` is the type it shares with worker-kit's `WorkerManager`, so an app moves to a Redis-backed queue by changing the constructor.
