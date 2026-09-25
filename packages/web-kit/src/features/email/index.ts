import type { Feature } from '../../types';
import type { Kernel } from '../../kernel';
import type { Context, Next } from 'hono';
import { createEmailAdapter } from '@iskra-bun/mailer-kit';

export type { EmailConfig, EmailMessage, TemplateData, EmailAdapter } from '@iskra-bun/mailer-kit';
export { MockEmailAdapter } from '@iskra-bun/mailer-kit';

import type { EmailConfig, EmailAdapter, EmailMessage, TemplateData } from '@iskra-bun/mailer-kit';

declare module 'hono' {
    interface ContextVariableMap {
        email: EmailAdapter;
    }
}

// ─── Header-injection guards ─────────────────────────────────────────────────
//
// An attacker who controls a recipient address or a header value can inject CR
// or LF to smuggle extra SMTP headers (e.g. a hidden Bcc). Reject any address or
// header that carries a CR/LF before the message reaches the underlying adapter.

const CRLF = /[\r\n]/;

function assertNoCrlf(value: string, label: string): void {
    if (CRLF.test(value)) {
        throw new Error(`Invalid ${label}: control characters (CR/LF) are not allowed`);
    }
}

function assertRecipients(to: string | string[] | undefined, label: string): void {
    if (to === undefined) return;
    const recipients = Array.isArray(to) ? to : [to];
    for (const recipient of recipients) assertNoCrlf(recipient, label);
}

function validateMessage(message: EmailMessage): void {
    assertRecipients(message.to, 'recipient');
    assertRecipients(message.cc, 'cc recipient');
    assertRecipients(message.bcc, 'bcc recipient');
    if (message.replyTo !== undefined) assertNoCrlf(message.replyTo, 'replyTo');
    assertNoCrlf(message.subject, 'subject');
    if (message.headers) {
        for (const [name, value] of Object.entries(message.headers)) {
            assertNoCrlf(name, 'header name');
            assertNoCrlf(value, 'header value');
        }
    }
}

// Wrap an adapter so every send is validated centrally before delegation. The
// wrapper is a new object — it never mutates the underlying adapter.
function withValidation(adapter: EmailAdapter): EmailAdapter {
    return {
        send: (message: EmailMessage) => {
            validateMessage(message);
            return adapter.send(message);
        },
        sendTemplate: (templateName: string, to: string | string[], data: TemplateData) => {
            assertRecipients(to, 'recipient');
            return adapter.sendTemplate(templateName, to, data);
        },
    };
}

export class EmailFeature implements Feature {
    name = 'email';
    private adapter?: EmailAdapter;

    constructor(private config: EmailConfig) {}

    async initialize(kernel: Kernel): Promise<void> {
        this.adapter = withValidation(await createEmailAdapter(this.config));
        const app = kernel.getApp();
        app.use('*', async (c: Context, next: Next) => {
            if (this.adapter) c.set('email', this.adapter);
            await next();
        });
    }

    getAdapter(): EmailAdapter {
        if (!this.adapter) throw new Error('Email not initialized');
        return this.adapter;
    }
}
