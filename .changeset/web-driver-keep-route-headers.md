---
"@iskra-bun/web-kit": patch
---

`WebDriver` no longer overwrites a security header a route set itself: a route answering `X-Frame-Options: DENY` (or its own `X-Content-Type-Options` / `Referrer-Policy`) keeps it, and the default is only added when the header is absent, as the Kernel already does.
