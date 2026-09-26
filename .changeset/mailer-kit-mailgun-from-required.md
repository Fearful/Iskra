---
"@iskra-bun/mailer-kit": patch
---

The Mailgun adapter requires a sender, like the SMTP, SendGrid and SES adapters: with no `from` on the message or in the config, `send()` throws `From address required` before calling Mailgun. It used to post the message without one, which Mailgun rejects with a 400.
