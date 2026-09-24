---
"@iskra-bun/worker-kit": minor
---

Job routing and connection fixes.

- A job with no registered handler used to be marked **completed** (the worker returned early), so it silently disappeared. It now fails with BullMQ's `UnrecoverableError` (no pointless retries), stays in the failed set, and is dead-lettered when `deadLetter` is on.
- New `consume: false` option for producer-only processes (e.g. an API node): `start()` creates no `Worker`, and `enqueue` accepts jobs whose handler lives in another process. Previously every producer had to register the handler and therefore also consume jobs.
- Redis URLs keep the ACL username, percent-decode credentials, and `rediss://` enables TLS.
- BullMQ queue/worker connection errors go to the app logger instead of the console.
