import type { Feature } from '../../types';
import type { Kernel } from '../../kernel';
import type { Context, Next } from 'hono';
import { checkRecipients, checkReplyTo, createEmailAdapter } from '@iskra-bun/mailer-kit';

export type {
    EmailConfig,
    EmailMessage,
    EmailAddress,
    EmailRecipient,
    TemplateData,
    EmailAdapter,
} from '@iskra-bun/mailer-kit';
export { MockEmailAdapter } from '@iskra-bun/mailer-kit';

import type { EmailConfig, EmailAdapter, EmailMessage, EmailRecipient, TemplateData } from '@iskra-bun/mailer-kit';

declare module 'hono' {
    interface ContextVariableMap {
        email: EmailAdapter;
    }
}

// ─── Header-injection guards ─────────────────────────────────────────────────
//
// An attacker who controls a recipient address or a header value can inject CR
// or LF to smuggle extra SMTP headers (e.g. a hidden Bcc), or pass a list or a
// group (`bob@x.com <spy@evil.test>`, `list: spy@evil.test;`) to add
// recipients. Every recipient must be one bare address (or `{ name, address }`),
// and no header may carry a CR/LF, before the message reaches the adapter.

const CRLF = /[\r\n]/;

function assertNoCrlf(value: string, label: string): void {
    if (CRLF.test(value)) {
        throw new Error(`Invalid ${label}: control characters (CR/LF) are not allowed`);
    }
}

function validateMessage(message: EmailMessage): void {
    checkRecipients(message.to, 'recipient');
    checkRecipients(message.cc, 'cc recipient');
    checkRecipients(message.bcc, 'bcc recipient');
    checkReplyTo(message.replyTo);
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
    // async: a rejected message is a rejected promise, which `.catch()` sees
    // (a synchronous throw escaped it).
    return {
        send: async (message: EmailMessage) => {
            validateMessage(message);
            return adapter.send(message);
        },
        sendTemplate: async (templateName: string, to: EmailRecipient | EmailRecipient[], data: TemplateData) => {
            checkRecipients(to, 'recipient');
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
