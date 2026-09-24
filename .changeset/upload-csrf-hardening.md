---
"@iskra-bun/web-kit": minor
---

**Security (breaking):** upload routes and `requireCsrf`.

- `UploadFeature` with `exposeRoutes: true` now requires an `authorize(c, action)` callback (throws at construction otherwise); the routes previously let anyone list, download, overwrite and delete every file. Pass `authorize: () => true` to keep them public on purpose.
- Upload bodies are cut off as soon as they exceed `maxFileSize` (plus multipart overhead) instead of being buffered whole first; oversized uploads now return **413** (was 400).
- Uploaded filenames go through the same `safeBasename` as `uploadFromRequest`, and storage errors are logged instead of being echoed to the client.
- `requireCsrf()` now actually validates the request token (it only checked that a token existed, which is always true), so it can guard routes whose method is in `ignoreMethods`; it fails closed when `CsrfFeature` is not registered.
