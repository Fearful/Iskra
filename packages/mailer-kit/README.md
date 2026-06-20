# @iskra-bun/mailer-kit

Envio de correo de Iskra, agnostico del transporte. Adaptadores intercambiables de SMTP, SendGrid, Mailgun, SES y un mock para tests. Sin acoplamiento HTTP: usalo en workers, cron o cualquier proceso.

## Instalacion

```bash
bun add @iskra-bun/mailer-kit @iskra-bun/core
```

## Uso rapido

```typescript
import { createEmailAdapter } from '@iskra-bun/mailer-kit'

const mailer = await createEmailAdapter({
    provider: 'smtp',
    smtp: { host: 'smtp.example.com', port: 587, username: 'user', password: 'pass' },
    from: { name: 'Mi App', email: 'noreply@example.com' },
})

await mailer.send({
    to: 'usuario@example.com',
    subject: 'Hola',
    html: '<p>Bienvenido</p>',
})
```

Cambia `provider` entre `mock`, `smtp`, `sendgrid`, `mailgun` o `ses`; la API (`send`/`sendTemplate`) es identica entre adaptadores.

## Documentacion

Guia completa: [docs/mailer-kit.md](../../docs/mailer-kit.md)

## Licencia

AGPL-3.0-or-later
