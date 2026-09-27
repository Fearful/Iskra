---
"@iskra-bun/mailer-kit": patch
---

The SES adapter builds one `SESv2Client` on its first send and reuses it, instead of building a new client (and its connection pool) for every message. A failed SDK import is not cached: the next send retries it.
