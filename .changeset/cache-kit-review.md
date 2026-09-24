---
"@iskra-bun/cache-kit": patch
---

Concurrent `set()` calls with the same tag no longer lose keys from the tag index (within a process), so `invalidateTag()` deletes them all. The prototype-pollution guard also catches an escaped `"__proto__"` key. `remember()` rethrows the fallback's own error instead of wrapping it in a plain `Error`. The memory adapter keeps entries whose TTL exceeds `setTimeout`'s limit, and a negative TTL is rejected.
