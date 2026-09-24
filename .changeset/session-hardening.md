---
"@iskra-bun/web-kit": minor
---

**Security (breaking):** `SessionFeature` hardening.

- Emptying the session (e.g. `delete session.userId` on logout, or `c.set("session", {})`) now deletes the stored session and the cookie. Previously the empty session was simply not saved, so the old data loaded again on the next request and logout silently did nothing with the cache/db stores.
- New `c.get("regenerateSession")()` issues a fresh session ID and invalidates the old one; call it after login to prevent session fixation.
- The cookie is `Secure` by default in production (`KernelConfig.environment` or `NODE_ENV`), and always with `sameSite: "None"`; `cookieOptions.secure` still overrides it.
- The cookie signature is compared in constant time.
- The `secret` must be at least 32 characters (same bar as `AuthFeature`); shorter secrets now throw.
