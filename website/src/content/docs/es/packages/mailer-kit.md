---
title: Mailer Kit
description: Envío de correo electrónico independiente del transporte con adaptadores SMTP, SendGrid, Mailgun y SES.
---

Envío de correo electrónico independiente del transporte con adaptadores intercambiables: SMTP, SendGrid, Mailgun, SES, más un mock para pruebas. Sin acoplamiento HTTP, por lo que funciona en workers, cron jobs o cualquier proceso.

## Inicio Rapido

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

### Mock (pruebas)

No realiza ninguna E/S de red y es silencioso (no escribe nada en stdout):

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

Usa `@aws-sdk/client-sesv2`, cargado de forma diferida solo al enviar:

```typescript
const mailer = await createEmailAdapter({
    provider: 'ses',
    region: 'us-east-1',
    from: { email: 'noreply@example.com' },
});
```

## API

```typescript
// Enviar un mensaje
await mailer.send({
    to: 'usuario@example.com',        // o un array de direcciones
    subject: 'Asunto',
    text: 'Cuerpo en texto plano',
    html: '<p>Cuerpo en HTML</p>',
    cc: 'copia@example.com',
    bcc: ['oculta@example.com'],
    replyTo: 'responder@example.com',
});

// Enviar usando una plantilla
await mailer.sendTemplate('welcome', 'usuario@example.com', { name: 'Ada' });
```

Todos los adaptadores devuelven `{ messageId, success }`.

## Variables de Entorno

```bash
# SMTP
SMTP_USER=usuario
SMTP_PASS=secreto

# SendGrid
SENDGRID_API_KEY=SG.xxxx

# Mailgun
MAILGUN_API_KEY=key-xxxx

# SES (credenciales AWS estándar)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=xxxx
AWS_SECRET_ACCESS_KEY=xxxx
```
