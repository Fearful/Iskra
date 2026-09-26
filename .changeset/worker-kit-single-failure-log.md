---
"@iskra-bun/worker-kit": patch
---

A job whose handler throws is logged once at error level ("Job failed", now with `attemptsMade`) instead of twice: the processor also logged a `JobError` at error level before BullMQ's `failed` event logged it again. That processor log is now debug.
