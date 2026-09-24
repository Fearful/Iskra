---
"@iskra-bun/web-kit": patch
---

Sessions: a request still in flight no longer re-creates a session that another request destroyed meanwhile. Before, a slow request re-saved it when it finished, which undid a logout made in another tab and brought back the old ID after a login's `regenerateSession()`. With the memory store, which handed every request the same object, that old ID, possibly one an attacker had fixed, even came back carrying the login's `userId`. The memory and cache-backed stores now keep and hand out copies of the session data, which must therefore be structured-cloneable.
