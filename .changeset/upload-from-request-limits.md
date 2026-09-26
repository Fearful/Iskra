---
"@iskra-bun/web-kit": minor
---

**Breaking (0.x):** `UploadHelper#uploadFromRequest()` (`c.get('upload')`) now applies the upload route's rules. It reads the multipart body only up to `maxFileSize` (plus multipart overhead) and throws an `HttpError` 413 `File too large` past it, and it refuses an extension `allowedExtensions` does not allow (by default, active content such as `.html`, `.svg`, `.js`) with an `HttpError` 400 `Invalid extension`. It used to read any body whole and store any extension. `UploadFeature` passes its `maxFileSize` and `allowedExtensions` to the helper, which takes them as an optional third constructor argument (`{ maxFileSize?, allowedExtensions? }`, 10 MiB and no active content by default).
