---
"@iskra-bun/core": minor
---

`ErrorCode` accepts an app's own codes: declare them by merging into `ErrorCodeRegistry` (`declare module '@iskra-bun/core' { interface ErrorCodeRegistry { ORDER_LOCKED: true } }`) and use them in `IskraError`/`HttpError`. It was a closed union of Iskra's codes. New codes: `METHOD_NOT_ALLOWED`, `PAYLOAD_TOO_LARGE`, `RATE_LIMITED`, `SERVICE_UNAVAILABLE` and `TIMEOUT`.
