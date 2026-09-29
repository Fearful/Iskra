---
"@iskra-bun/web-kit": minor
---

Every response follows one response contract, set once in `KernelConfig.contract` (or WebPlugin's): the Kernel's error handler and its 404, `validate()`, `validateJson()`, OpenAPI's validation hook and routes, the upload routes, WebDriver, the features that refuse a request (they throw Hono's `HTTPException`) and the new `ok(c, data)`, `list(c, page)` and `fail(c, error)` helpers. There were five error shapes (`{ message }`, `{ error, status }`, `{ error, status, code }`, `{ success: false, error, code, details, timestamp }`, `{ error }`) and Hono's plain-text 404. `iskraContract` is the default, `problemDetailsContract()` answers RFC 9457 problem details, and an app's own contract (`toProblem`, `error`, `success`, `list`, `log`) keeps the responses of a service it migrates.

- The default error body is `{ error, status, code, details?, context?, stack?, requestId? }`, what the SDKs read, with or without `ErrorHandlerFeature`, which now only sets `includeStack`, `customHandlers` and `logger`. A `HTTPException` gets the code of its status (`429` → `RATE_LIMITED`) and the request id; any other `IskraError` answers the status of its code (`NOT_FOUND` → 404, `TIMEOUT` → 504) and shows its message only when marked `expose`. A HEAD request gets no body.
- `throw new NotFoundError()` without `ErrorHandlerFeature` answered 500; it answers 404.
- WebDriver answered every thrown error with a 500, a `ValidationError` too; an `HttpError` now keeps its status.
- `HttpError` takes `headers` (`Retry-After`, `WWW-Authenticate`), and its code defaults to its status's (`codeForStatus`) instead of `INTERNAL_ERROR`. `statusForCode` and `codeForStatus` are exported.
- `KernelConfig.includeStack` (default only with NODE_ENV=development) and `securityHeaders: false`, which sets none of the security headers.
- **Breaking:** a route that does not exist answers a JSON 404 (`{ "error": "Not Found", "status": 404, "code": "NOT_FOUND" }`) instead of Hono's plain text, the Kernel's default error body is no longer `{ message }`, and a failed validation answers `{ error, status, code, details }` without `success` and `timestamp`.
