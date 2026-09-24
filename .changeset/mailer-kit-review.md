---
"@iskra-bun/mailer-kit": patch
---

Each SendGrid adapter uses its own client: the shared default client meant the last adapter created set the API key for all of them. The `from` display name is quoted or encoded by every adapter, so a name with quotes can no longer add another sender, and malformed addresses are rejected. SMTP and SendGrid forward `headers` (with the Mailgun allowlist) instead of dropping them; SendGrid base64-encodes string attachments. SES rejects messages with attachments or headers instead of silently sending them without.
