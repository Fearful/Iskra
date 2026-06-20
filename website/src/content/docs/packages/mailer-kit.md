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

```typescript
const mailer = await createEmailAdapter({
    provider: 'smtp',
    smtp: { host: 'smtp.example.com', port: 587, username: 'u', password: 'p', secure: false },
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

### SES

Uses `@aws-sdk/client-sesv2`, lazily loaded only when sending:

```typescript
const mailer = await createEmailAdapter({
    provider: 'ses',
    region: 'us-east-1',
    from: { email: 'noreply@example.com' },
});
```

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

// Send using a template
await mailer.sendTemplate('welcome', 'usuario@example.com', { name: 'Ada' });
```

All adapters return `{ messageId, success }`.

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
