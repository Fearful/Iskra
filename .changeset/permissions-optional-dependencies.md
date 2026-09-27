---
"@iskra-bun/web-kit": patch
---

`PermissionsFeature` now runs after `auth`, `session` and `cache` whatever the order they are registered in, and none of them is required. It depended on `auth` only, so a session or cache feature registered after it ran too late: a user held in the session was treated as anonymous, and permissions were never cached. Without an auth feature it used to fail at startup; now every request is anonymous and gets only `anonymousPermissions`.
