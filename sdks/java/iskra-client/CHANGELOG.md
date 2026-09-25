# Changelog

## Unreleased

- **Examples and docs:** the Spring MVC example no longer returns Iskra's error text (its messages, the host and port of a failed connection) or the full health payload to anonymous callers: they go to the log and callers get a generic error and `{"status"}`. The READMEs no longer suggest `rateLimit: false` "and limit in this app" (the examples limit nothing): they say to raise the limit and add a per-user one. The storage section shows how to keep each user in their own folder, since an `authorize` that only checks for a session lets every user list, download and delete everyone's files.
- **Storage:** a file name or subfolder segment `.` or `..` is rejected: URI normalization resolved it, so `download("x", "../contract")` left the upload routes and sent the API key and session cookie to another route.
- **Requests:** a path must start with `/`; concatenated to the base URL, `"@other-host/x"` sent the request, API key included, to another host.
- **Timeouts:** the configured timeout covers the whole response, body included; `HttpRequest.timeout()` stopped at the headers, so a stalled body blocked the caller forever.
- **Config:** `IskraConfig` copies the builder's headers (later changes to the builder changed the built config).
- Jackson 2.18.9 (2.17.0 has known advisories). The Spring MVC example moves to Spring 6.2 / Jakarta Servlet 6 / Java 17 (Spring 5.3 is end-of-life and vulnerable) and was run on Jetty 12 against the contract server.

## 0.2.0

Tested against a real Iskra service (`sdks/contract/server.ts`) with JUnit instead of assumed response shapes.

- **Build:** the SDK compiles again: `dev.iskra.client.storage.StorageClient` was referenced but missing. Compiled with `--release 11`.
- **Storage:** `StorageClient` implemented against `UploadFeature`'s routes: `upload` (path or bytes, optional name and subfolder), `list`, `download`, `delete`, `withRoutePrefix` (returns a new client). Multipart filenames are UTF-8 and percent-encode `"`/CR/LF as browsers do, so a name cannot break out of the header.
- **Sessions:** `signIn`/`signUp` return a `Session` with `getCookie()` (Better Auth's session token), and `withSession(session)` makes requests as that user; clients never store cookies, so one instance can serve every user. Session requests send an `Origin` header (`.origin(...)` to override), which Better Auth requires for POSTs such as sign-out. `getSession`/`signOut` accept a session.
- **Responses:** every body used to be read as `{"success", "data"}`, so sign-in, health and plain JSON routes returned null data and arrays failed. Plain JSON (objects and arrays) is now the data, fields next to `success` become the data, text bodies map to `String`/`Object`, and `IskraResponse.getStatusCode()` is set. `post`/`put` also take a `TypeReference`.
- **Errors:** messages are read from `error` or `message` (Better Auth, the Kernel's default handler) and from plain-text bodies; details fall back to `context`; new `ConflictException` (409). An interrupted request keeps the thread's interrupt flag.
- **Health:** `check()`/`ready()` return the body on 503 (a failing check) instead of throwing; `isHealthy()`.
- The Spring MVC example keeps one client, carries the user's session in an HttpOnly cookie, and was run against the contract server.
