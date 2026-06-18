import type { Feature } from "../../types";
import type { Kernel } from "../../kernel";
import type { Context, Next } from "hono";

export interface EmailConfig {
    provider: "smtp" | "sendgrid" | "mock" | "mailgun" | "ses";
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
    sendTemplate(templateName: string, to: string | string[], data: TemplateData): Promise<{ messageId: string; success: boolean }>;
}

class MockEmailAdapter implements EmailAdapter {
    async send(message: EmailMessage) {
        console.log("📧 [MOCK] Sent to", message.to, "Subject:", message.subject);
        return { messageId: `mock-${Date.now()}`, success: true };
    }
    async sendTemplate(name: string, to: string | string[], data: TemplateData) {
        return this.send({ to, subject: `Template: ${name}`, html: `Template ${name} with data: ${JSON.stringify(data)}` });
    }
}

declare module "hono" {
    interface ContextVariableMap {
        email: EmailAdapter;
    }
}

export class EmailFeature implements Feature {
    name = "email";
    private adapter?: EmailAdapter;

    constructor(private config: EmailConfig) { }

    async initialize(kernel: Kernel): Promise<void> {
        this.adapter = await this.createAdapter(this.config);
        const app = kernel.getApp();
        app.use("*", async (c: Context, next: Next) => {
            if (this.adapter) c.set("email", this.adapter);
            await next();
        });
        console.log(`✅ EmailFeature initialized (${this.config.provider})`);
    }

    private async createAdapter(config: EmailConfig): Promise<EmailAdapter> {
        switch (config.provider) {
            case "mock": return new MockEmailAdapter();
            case "smtp": {
                // Lazy load to avoid import issues if not installed/configured in all envs (though we added deps)
                const { SmtpEmailAdapter } = await import("./providers/smtp");
                return new SmtpEmailAdapter(config);
            }
            case "sendgrid": {
                const { SendGridEmailAdapter } = await import("./providers/sendgrid");
                return new SendGridEmailAdapter(config);
            }
            case "mailgun": {
                const { MailgunEmailAdapter } = await import("./providers/mailgun");
                return new MailgunEmailAdapter(config);
            }
            default: throw new Error(`Provider ${config.provider} not implemented`);
        }
    }

    getAdapter(): EmailAdapter {
        if (!this.adapter) throw new Error("Email not initialized");
        return this.adapter;
    }
}

export { MockEmailAdapter };
