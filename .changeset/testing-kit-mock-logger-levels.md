---
"@iskra-bun/testing-kit": patch
---

`createMockLogger()` reports every level as enabled: `isLevelEnabled()` returns `true` and `level` is `'trace'` (they were `false` and `'error'`), so code that guards a log call with `isLevelEnabled()` reaches the capture arrays.
