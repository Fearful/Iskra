---
"@iskra-bun/web-kit": patch
---

`ErrorHandlerFeature` now includes a `ValidationError`'s `details` in the response body (`{ error, status, code, details }`); they were dropped, so clients never saw which fields failed.
