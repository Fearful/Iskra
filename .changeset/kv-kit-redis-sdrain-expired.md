---
"@iskra-bun/kv-kit": patch
---

The Redis adapter's `sdrain()` returns only the members that have not expired, as the memory adapter does. It returned every member still stored, expired ones included, until the next `sadd()` dropped them; it now reads and deletes the set in one script that filters by Redis time.
