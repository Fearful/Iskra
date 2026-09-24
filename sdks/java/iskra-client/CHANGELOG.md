# Changelog

## 0.2.0

Tested against a real Iskra service (`sdks/contract/server.ts`) with JUnit instead of assumed response shapes.

- **Build:** the SDK compiles again: `dev.iskra.client.storage.StorageClient` was referenced but missing. Compiled with `--release 11`.
- **Storage:** `StorageClient` implemented against `UploadFeature`'s routes: `upload` (path or bytes, optional name and subfolder), `list`, `download`, `delete`, `withRoutePrefix` (returns a new client). Multipart filenames are UTF-8 and percent-encode `"`/CR/LF as browsers do, so a name cannot break out of the header.
- **Sessions:** `signIn`/`signUp` return a `Session` with `getCookie()` (Better Auth's session token), and `withSession(session)` makes requests as that user; clients never store cookies, so one instance can serve every user. Session requests send an `Origin` header (`.origin(...)` to override), which Better Auth requires for POSTs such as sign-out. `getSession`/`signOut` accept a session.
- **Responses:** every body used to be read as `{"success", "data"}`, so sign-in, health and plain JSON routes returned null data and arrays failed. Plain JSON (objects and arrays) is now the data, fields next to `success` become the data, text bodies map to `String`/`Object`, and `IskraResponse.getStatusCode()` is set. `post`/`put` also take a `TypeReference`.
- **Errors:** messages are read from `error` or `message` (Better Auth, the Kernel's default handler) and from plain-text bodies; details fall back to `context`; new `ConflictException` (409). An interrupted request keeps the thread's interrupt flag.
- **Health:** `check()`/`ready()` return the body on 503 (a failing check) instead of throwing; `isHealthy()`.
- The Spring MVC example keeps one client, carries the user's session in an HttpOnly cookie, and was run against the contract server.
