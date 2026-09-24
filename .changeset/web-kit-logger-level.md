---
"@iskra-bun/web-kit": patch
---

`LoggerFeature` honors its `level` option: only messages at or above it are written (`trace` < `debug` < `info` < `warning` < `error` < `fatal`). It was ignored, so `level: "error"` still printed debug and info messages. Without a `level` everything is written, as before.
