# @iskra-bun/mailer-kit

## 0.1.0

### Minor Changes

- f9654df: Initial public release. Transport-agnostic email kit extracted from web-kit: `EmailAdapter` interface, `MockEmailAdapter`, SMTP/SendGrid/Mailgun/SES providers, and a `createEmailAdapter` factory — usable from workers and cron jobs without an HTTP layer. The previously-unimplemented SES provider is now complete.

### Patch Changes

- Mailer hardening across providers:

    - `sendTemplate` now throws `sendTemplate not supported by <provider>` for the SMTP, Mailgun, SES and SendGrid providers instead of silently reporting success without sending anything.
    - The SMTP provider enforces TLS: `secure: true` on port 465, otherwise `requireTLS: true`, with `tls.rejectUnauthorized: true`.
    - The Mailgun provider applies a custom-header allowlist (throwing on non-allowlisted headers) and strips CR/LF from header values, preventing email header injection.

- Updated dependencies [f9654df]
- Updated dependencies
- Updated dependencies [f9654df]
    - @iskra-bun/core@0.1.1
