---
"@iskra-bun/web-kit": patch
---

`RateLimitFeature`'s `X-RateLimit-Reset` header now reports when the client's current window ends. It was `now + windowMs` on every request, so it moved forward with each hit. The memory store reports the window's real end; the `cache` store knows it on the window's first hit and otherwise sends `now + windowMs`, an upper bound.
