---
"@iskra-bun/testing-kit": patch
---

`createTestServer()` keeps headers passed as a `Headers` instance or as tuples along with a JSON body (they were lost or broke the request), and a caller's `Content-Type` in any case replaces the JSON default instead of being sent next to it.
