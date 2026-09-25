export interface EmailConfig {
    provider: 'smtp' | 'sendgrid' | 'mock' | 'mailgun' | 'ses';
    smtp?: {
        host: string;
        port: number;
        username: string;
        password: string;
        secure?: boolean;
    };
    apiKey?: string;
    apiSecret?: string;
    region?: string;
    domain?: string;
    baseUrl?: string;
    from?: { name?: string; email: string };
    templateDir?: string;
}

/** An address with an optional display name. */
export interface EmailAddress {
    name?: string;
    address: string;
}

/** A recipient: a bare address, or `{ name, address }` to give it a display name. */
export type EmailRecipient = string | EmailAddress;

export interface EmailMessage {
    /**
     * Each entry is one bare address (`a@x.com`), or `{ name, address }` for a
     * display name: a string with a name, a list or a group is rejected.
     */
    to: EmailRecipient | EmailRecipient[];
    from?: { name?: string; email: string };
    subject: string;
    text?: string;
    html?: string;
    cc?: EmailRecipient | EmailRecipient[];
    bcc?: EmailRecipient | EmailRecipient[];
    replyTo?: EmailRecipient;
    attachments?: Array<{ filename: string; content: Uint8Array | string; contentType?: string }>;
    headers?: Record<string, string>;
}

export interface TemplateData {
    [key: string]: unknown;
}

export interface EmailAdapter {
    send(message: EmailMessage): Promise<{ messageId: string; success: boolean }>;
    sendTemplate(
        templateName: string,
        to: EmailRecipient | EmailRecipient[],
        data: TemplateData,
    ): Promise<{ messageId: string; success: boolean }>;
}
