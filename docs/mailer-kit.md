# @iskra-bun/mailer-kit

Envio de correo agnostico del transporte, con adaptadores de SMTP, SendGrid, Mailgun y SES (mas un mock para tests). No depende de la capa HTTP, asi que sirve en workers, cron o cualquier proceso.

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

### Mock (tests)

No hace I/O de red y es silencioso (no escribe en stdout):

```typescript
const mailer = await createEmailAdapter({ provider: 'mock' });
```

### SMTP

El transporte aplica TLS por defecto: usa `secure: true` (TLS implicito) en el puerto 465 y, en cualquier otro puerto, fuerza STARTTLS con `requireTLS: true`. Ademas, `tls.rejectUnauthorized` siempre es `true`, asi que los certificados se validan. Un `secure` explicito en la config gana sobre el valor por defecto.

```typescript
const mailer = await createEmailAdapter({
    provider: 'smtp',
    smtp: { host: 'smtp.example.com', port: 587, username: 'u', password: 'p' },
    from: { email: 'noreply@example.com' },
});
```

Para servidores locales o de desarrollo que solo escuchan en el puerto 465 con TLS implicito, fija `secure: true`:

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

#### Cabeceras personalizadas (allowlist)

Las cabeceras que pasas en `headers` no se reenvian sin control: solo se permiten nombres de una lista blanca y el resto se rechaza lanzando un error (proteccion contra inyeccion de cabeceras). Ademas, todo lo que venga despues de un CR o LF en el valor se descarta para evitar inyeccion.

Cabeceras permitidas:

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
    to: 'usuario@example.com',
    subject: 'Boletin',
    html: '<p>Hola!</p>',
    headers: { 'List-Unsubscribe': '<https://example.com/unsub>' },
});

// Esto lanza un error: el nombre no esta en la allowlist.
await mailer.send({
    to: 'usuario@example.com',
    subject: 'x',
    text: 't',
    headers: { 'X-Custom': 'valor' }, // Error: Header "X-Custom" is not allowed
});
```

### SES

Usa `@aws-sdk/client-sesv2` (cargado de forma diferida solo al enviar):

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
    to: 'usuario@example.com',        // o un arreglo de direcciones
    subject: 'Asunto',
    text: 'Cuerpo en texto plano',
    html: '<p>Cuerpo en HTML</p>',
    cc: 'copia@example.com',
    bcc: ['oculta@example.com'],
    replyTo: 'responder@example.com',
});
```

Todos los adapters devuelven `{ messageId, success }`.

### Plantillas (no soportadas todavia)

El renderizado de plantillas del lado del proveedor aun no esta implementado. La interfaz expone `sendTemplate(templateName, to, data)`, pero hoy cada adaptador (SMTP, SendGrid, Mailgun, SES) lanza `Error("sendTemplate not supported by <provider>")` en lugar de enviar nada. Esto es intencional: falla en voz alta en vez de mandar silenciosamente un cuerpo de marcador de posicion. Renderiza tu HTML antes de llamar y usa `send()` con el campo `html`.

## Variables de Entorno

```bash
# SMTP
SMTP_USER=usuario
SMTP_PASS=secreto

# SendGrid
SENDGRID_API_KEY=SG.xxxx

# Mailgun
MAILGUN_API_KEY=key-xxxx

# SES (credenciales estandar de AWS)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=xxxx
AWS_SECRET_ACCESS_KEY=xxxx
```
