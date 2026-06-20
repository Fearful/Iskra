---
"@iskra-bun/db-kit": patch
---

Scrub credentials from the URL placed in `ConnectionError` context so passwords no longer leak into structured logs. The MySQL driver now uses a connection pool (`createPool`) instead of a single serialized connection.
