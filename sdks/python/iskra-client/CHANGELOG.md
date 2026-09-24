# Changelog

## 0.2.0

Tested against a real Iskra service (`sdks/contract/server.ts`) instead of assumed response shapes.

- **Storage:** `iskra.storage` is implemented (the module was missing, so `import iskra_client` failed): `upload` (path, bytes or file object), `list`, `download`, `delete`, `with_route_prefix` (returns a new client), and their `async_*` variants, against `UploadFeature`'s routes.
- **Sessions:** the client no longer keeps cookies between calls, so one instance can serve every user of a backend without leaking sessions. `sign_in`/`sign_up` return a `Session` with `cookie`, and `with_session(session)` makes requests as that user. Cookie-authenticated requests send an `Origin` header (`origin=` to override), which Better Auth requires for POSTs such as sign-out. `get_session`/`sign_out` accept a session.
- **Auth responses:** `sign_in`/`sign_up` map Better Auth's `{token, user}` body (the token and user were lost), and `get_session` returns `data=None` when there is no session. `sign_up` sends a `name` (Better Auth requires one), defaulting to the email's local part.
- **Responses:** fields next to `success` (e.g. upload results) become `data` instead of being dropped; text bodies no longer raise `JSONDecodeError`; `IskraResponse.status_code`; `get`/`async_get` take `params`.
- **Errors:** messages are read from `error` or `message` (Better Auth, the Kernel's default handler) and from plain-text bodies; `details` falls back to `context`; new `ConflictException` (409).
- **Health:** `check()`/`ready()` return the body on 503 (a failing check) instead of raising; `is_healthy()`.
- **Async:** one `httpx.AsyncClient` per event loop, so async calls work from code that runs each call in a new loop (e.g. Django's `async_to_sync`).
- The FastAPI example keeps one client for the app, closes it on shutdown, and carries the user's session in an HttpOnly cookie.
