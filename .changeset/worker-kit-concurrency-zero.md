---
"@iskra-bun/worker-kit": patch
---

`concurrency: 0` now means producer-only, like `consume: false`. It used to fall back to a concurrency of 1, so a service that set it to only enqueue (forms-app's forms-api did) also consumed jobs from the queue it had no handler for, and those jobs were lost.
