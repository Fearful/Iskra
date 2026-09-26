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

Las cabeceras que pasas en `headers` no se reenvian sin control: solo se permiten nombres de una lista blanca y el resto se rechaza lanzando un error (proteccion contra inyeccion de cabeceras). Ademas, todo lo que venga despues de un CR o LF en el valor se descarta para evitar inyeccion; el `subject` de Mailgun se corta igual en un CR o LF. La misma lista se aplica a SMTP y SendGrid; las dos cabeceras `X-Mailgun-*` solo a Mailgun.

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

Usa `@aws-sdk/client-sesv2`, cargado de forma diferida en el primer envío; el adaptador crea un solo `SESv2Client` y lo reutiliza en los envíos siguientes:

```typescript
const mailer = await createEmailAdapter({
    provider: 'ses',
    region: 'us-east-1',
    from: { email: 'noreply@example.com' },
});
```

El adaptador de SES todavia no soporta `attachments` ni `headers`: un mensaje con alguno de ellos se rechaza con un error en vez de enviarse sin ellos.

## API

```typescript
// Enviar un mensaje
await mailer.send({
    to: 'usuario@example.com',        // o un array de destinatarios
    subject: 'Asunto',
    text: 'Cuerpo en texto plano',
    html: '<p>Cuerpo en HTML</p>',
    cc: { name: 'Ana', address: 'ana@example.com' },   // con nombre visible
    bcc: ['oculta@example.com'],
    replyTo: 'responder@example.com',
});
```

Todos los adaptadores devuelven `{ messageId, success }`.

### Destinatarios

Cada entrada de `to`, `cc`, `bcc` y `replyTo` es **una sola direccion**, o un objeto
`{ name, address }` para darle un nombre visible. Un string que incluye un nombre
visible, una lista o un grupo se rechaza antes de enviar nada, en todos los
adaptadores (tambien el mock): los proveedores leen ese valor como una lista de
direcciones, asi que `"bob@example.com <attacker@evil.test>, x@example.com"` enviaba
a `attacker@evil.test`, y `"undisclosed: a@evil.test; b@x.com"` o
`"a@evil.test:b@x.com"` enviaban a personas que una allowlist que revisaba el texto
nunca vio. Una direccion no puede contener espacios, caracteres de control ni
`<>()[]\,;:"`, y debe tener exactamente una `@`; un nombre no puede contener
caracteres de control (CR/LF). `replyTo` acepta un solo destinatario.

```typescript
await mailer.send({ to: ['a@example.com', 'b@example.com'], subject: 'x', text: 't' }); // ok
await mailer.send({ to: { name: 'Bob Smith', address: 'bob@example.com' }, subject: 'x', text: 't' }); // ok
await mailer.send({ to: 'Bob Smith <bob@example.com>', subject: 'x', text: 't' }); // Error: Invalid email address
await mailer.send({ to: 'a@example.com, b@example.com', subject: 'x', text: 't' }); // Error: pasa un array
```

`checkRecipients(value)` aplica las mismas reglas, por si quieres validar la entrada por tu cuenta.

Todos los adaptadores salvo el mock exigen un remitente: el `from` del mensaje o el de la configuracion; si falta, `send()` lanza `From address required` antes de contactar al proveedor (Mailgun enviaba sin el). Todos los adaptadores ponen entre comillas (o codifican, si no es ASCII) el nombre visible de `from` (y el de un destinatario), asi que no puede agregar otra direccion. Un `content` de adjunto de tipo string es texto; para archivos binarios pasa un `Uint8Array`.

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

# SES (credenciales AWS estándar)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=xxxx
AWS_SECRET_ACCESS_KEY=xxxx
```
