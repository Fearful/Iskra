---
"@iskra-bun/web-kit": patch
---

`ErrorHandlerFeature` no longer sends the `context` of an `HttpError` with a 5xx status unless `includeStack` is on; the message is still sent. A 5xx's context tends to describe the server (a DSN, a host), not the client's request. 4xx errors keep their `context`.
