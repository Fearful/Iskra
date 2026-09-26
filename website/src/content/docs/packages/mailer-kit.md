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

Headers passed in `headers` are not forwarded blindly: only an allowlist of names is permitted, and any other name is rejected with an error (header-injection protection). On top of that, anything after a CR or LF in the value is dropped to prevent injection; Mailgun's `subject` is cut at a CR or LF the same way. The same allowlist applies to SMTP and SendGrid; the two `X-Mailgun-*` headers only to Mailgun.

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

Uses `@aws-sdk/client-sesv2`, lazily loaded on the first send; the adapter builds one `SESv2Client` and reuses it for every later send:

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
    to: 'usuario@example.com',        // or an array of recipients
    subject: 'Asunto',
    text: 'Cuerpo en texto plano',
    html: '<p>Cuerpo en HTML</p>',
    cc: { name: 'Ana', address: 'ana@example.com' },   // a display name
    bcc: ['oculta@example.com'],
    replyTo: 'responder@example.com',
});
```

All adapters return `{ messageId, success }`.

### Recipients

Every `to`, `cc`, `bcc` and `replyTo` entry is **one bare address**, or a
`{ name, address }` object to give it a display name. A string that names a
display name, a list or a group is rejected before anything is sent, by every
adapter (the mock too): providers parse such a value as an address list, so
`"bob@example.com <attacker@evil.test>, x@example.com"` mailed
`attacker@evil.test`, and `"undisclosed: a@evil.test; b@x.com"` or
`"a@evil.test:b@x.com"` mailed people an allowlist that checked the text never
saw. An address may not contain whitespace, control characters or
`<>()[]\,;:"`, and must have exactly one `@`; a name may not contain control
characters (CR/LF). `replyTo` takes one recipient.

```typescript
await mailer.send({ to: ['a@example.com', 'b@example.com'], subject: 'x', text: 't' }); // ok
await mailer.send({ to: { name: 'Bob Smith', address: 'bob@example.com' }, subject: 'x', text: 't' }); // ok
await mailer.send({ to: 'Bob Smith <bob@example.com>', subject: 'x', text: 't' }); // Error: Invalid email address
await mailer.send({ to: 'a@example.com, b@example.com', subject: 'x', text: 't' }); // Error: pass an array
```

`checkRecipients(value)` applies the same rules, if you want to validate input yourself.

Every adapter except the mock requires a sender: the message's `from` or the config's, or `send()` throws `From address required` before contacting the provider (Mailgun used to send without one). The `from` display name (and a recipient's) is quoted (or encoded, when it is not ASCII) by every adapter, so it cannot add another address. A string attachment `content` is text; pass a `Uint8Array` for binary files.

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
