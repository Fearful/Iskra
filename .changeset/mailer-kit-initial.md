---
"@iskra-bun/mailer-kit": minor
---

Initial public release. Transport-agnostic email kit extracted from web-kit: `EmailAdapter` interface, `MockEmailAdapter`, SMTP/SendGrid/Mailgun/SES providers, and a `createEmailAdapter` factory — usable from workers and cron jobs without an HTTP layer. The previously-unimplemented SES provider is now complete.
