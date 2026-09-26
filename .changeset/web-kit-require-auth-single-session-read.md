---
"@iskra-bun/web-kit": patch
---

`requireAuth(kernel)` reuses the session the `AuthFeature` middleware already read for the request (`c.get('authUser')`) instead of calling `auth.api.getSession` again, which cost a second session lookup on every protected request. It still reads the session itself when the middleware did not set one, and answers 401 without a session as before.
