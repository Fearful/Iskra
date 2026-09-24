---
title: Mailer Kit
description: Transport-agnostic email sending with SMTP, SendGrid, Mailgun and SES adapters.
---

Transport-agnostic email sending with interchangeable adapters: SMTP, SendGrid, Mailgun, SES, plus a mock for tests. No HTTP coupling, so it works in workers, cron jobs or any process.

## Quick Start

```typescript
import { createEmailAdapter } from '@iskra-bun/mailer-kit';

const mailer = await createEmailAdapter({
    provider: 'smtp',
    smtp: {
        host: 'smtp.example.com',
        port: 587,
        username: process.env.SMTP_USER!,
        password: process.env.SMTP_PASS!,
    },
    from: { name: 'Mi App', email: 'noreply@example.com' },
});

await mailer.send({
    to: 'usuario@example.com',
    subject: 'Bienvenido',
    html: '<p>Hola!</p>',
});
```

## Adapters

### Mock (tests)

Performs no network I/O and is silent (writes nothing to stdout):

```typescript
const mailer = await createEmailAdapter({ provider: 'mock' });
```

### SMTP

The transport enforces TLS by default: it uses `secure: true` (implicit TLS) on port 465 and, on any other port, enforces STARTTLS with `requireTLS: true`. It also always sets `tls.rejectUnauthorized: true`, so certificates are validated. An explicit `secure` in the config wins over the default.

```typescript
const mailer = await createEmailAdapter({
    provider: 'smtp',
    smtp: { host: 'smtp.example.com', port: 587, username: 'u', password: 'p' },
    from: { email: 'noreply@example.com' },
});
```

For local or development servers that only listen on port 465 with implicit TLS, set `secure: true`:

```typescript
const mailer = await createEmailAdapter({
    provider: 'smtp',
    smtp: { host: 'localhost', port: 465, username: 'u', password: 'p', secure: true },
    from: { email: 'noreply@example.com' },
});
```

### SendGrid

```typescript
const mailer = await createEmailAdapter({
    provider: 'sendgrid',
    apiKey: process.env.SENDGRID_API_KEY!,
    from: { email: 'noreply@example.com' },
});
```

### Mailgun

```typescript
const mailer = await createEmailAdapter({
    provider: 'mailgun',
    apiKey: process.env.MAILGUN_API_KEY!,
    domain: 'mg.example.com',
    from: { email: 'noreply@example.com' },
});
```

#### Custom headers (allowlist)

Headers passed in `headers` are not forwarded blindly: only an allowlist of names is permitted, and any other name is rejected with an error (header-injection protection). On top of that, anything after a CR or LF in the value is dropped to prevent injection. The same allowlist applies to SMTP and SendGrid; the two `X-Mailgun-*` headers only to Mailgun.

Allowed headers:

- `Reply-To`
- `In-Reply-To`
- `References`
- `List-Unsubscribe`
- `List-Unsubscribe-Post`
- `List-Id`
- `X-Mailgun-Variables`
- `X-Mailgun-Tag`

```typescript
await mailer.send({
    to: 'user@example.com',
    subject: 'Newsletter',
    html: '<p>Hi!</p>',
    headers: { 'List-Unsubscribe': '<https://example.com/unsub>' },
});

// This throws: the name is not on the allowlist.
await mailer.send({
    to: 'user@example.com',
    subject: 'x',
    text: 't',
    headers: { 'X-Custom': 'value' }, // Error: Header "X-Custom" is not allowed
});
```

### SES

Uses `@aws-sdk/client-sesv2`, lazily loaded only when sending:

```typescript
const mailer = await createEmailAdapter({
    provider: 'ses',
    region: 'us-east-1',
    from: { email: 'noreply@example.com' },
});
```

The SES adapter does not support `attachments` or `headers` yet: a message with either is rejected with an error instead of being sent without them.

## API

```typescript
// Send a message
await mailer.send({
    to: 'usuario@example.com',        // or an array of addresses
    subject: 'Asunto',
    text: 'Cuerpo en texto plano',
    html: '<p>Cuerpo en HTML</p>',
    cc: 'copia@example.com',
    bcc: ['oculta@example.com'],
    replyTo: 'responder@example.com',
});
```

All adapters return `{ messageId, success }`.

The `from` display name is quoted (or encoded, when it is not ASCII) by every adapter, so it cannot add another address, and an email address with spaces, brackets, commas or quotes is rejected. A string attachment `content` is text; pass a `Uint8Array` for binary files.

### Templates (not supported yet)

Provider-side template rendering is not implemented yet. The interface exposes `sendTemplate(templateName, to, data)`, but today every adapter (SMTP, SendGrid, Mailgun, SES) throws `Error("sendTemplate not supported by <provider>")` instead of sending anything. This is intentional: it fails loudly rather than silently sending a placeholder body. Render your HTML before calling and use `send()` with the `html` field.

## Environment Variables

```bash
# SMTP
SMTP_USER=usuario
SMTP_PASS=secreto

# SendGrid
SENDGRID_API_KEY=SG.xxxx

# Mailgun
MAILGUN_API_KEY=key-xxxx

# SES (standard AWS credentials)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=xxxx
AWS_SECRET_ACCESS_KEY=xxxx
```
