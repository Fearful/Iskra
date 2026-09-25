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

export interface EmailMessage {
    to: string | string[];
    from?: { name?: string; email: string };
    subject: string;
    text?: string;
    html?: string;
    cc?: string | string[];
    bcc?: string | string[];
    replyTo?: string;
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
        to: string | string[],
        data: TemplateData,
    ): Promise<{ messageId: string; success: boolean }>;
}
