---
"@iskra-bun/web-kit": patch
---

`SessionFeature` with `store: 'db'` no longer swallows database errors: a failure reading, writing or deleting a session is logged and rethrown, so the request fails (500) instead of going on. A failed write used to be followed by a cookie for a session that was never stored, and a failed logout looked like a successful one. A row whose data is not valid JSON is still logged and treated as no session.
