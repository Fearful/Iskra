---
"@iskra-bun/mailer-kit": minor
---

**Breaking (0.x):** `Reply-To` is no longer accepted in a message's `headers`: set it with `message.replyTo`. The header's value was only cut at CR/LF, so it could carry several addresses or a display name that `replyTo`'s checks refuse. A `Reply-To` in `headers` now throws `Header "Reply-To" is not allowed: use message.replyTo`.
