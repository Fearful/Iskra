---
"@iskra-bun/cache-kit": patch
---

When indexing a tagged entry's tags fails, `set()` deletes the entry it just wrote before rejecting. The entry used to stay cached without being listed under its tags, so `invalidateTag()` never removed it.
