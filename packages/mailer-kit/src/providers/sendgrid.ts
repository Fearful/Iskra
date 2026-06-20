import type { EmailAdapter, EmailConfig, EmailMessage, TemplateData } from "../types";
import sgMail from "@sendgrid/mail";

export class SendGridEmailAdapter implements EmailAdapter {
    constructor(private config: EmailConfig) {
        if (!config.apiKey) throw new Error("SendGrid API Key required");
        sgMail.setApiKey(config.apiKey);
    }

    async send(message: EmailMessage) {
        const from = message.from || this.config.from;
        if (!from) throw new Error("From address required");

        const msg = {
            to: message.to,
            from: from.name ? { email: from.email, name: from.name } : from.email,
            subject: message.subject,
            text: message.text,
            html: message.html,
            cc: message.cc as any,
            bcc: message.bcc as any,
            replyTo: message.replyTo,
            attachments: message.attachments?.map(a => ({
                filename: a.filename,
                content: typeof a.content === 'string' ? a.content : Buffer.from(a.content).toString("base64"),
                type: a.contentType,
                disposition: "attachment"
            }))
        } as any;

        const [response] = await sgMail.send(msg);
        return { messageId: response.headers["x-message-id"] as string, success: true };
    }

    async sendTemplate(_templateName: string, _to: string | string[], _data: TemplateData): Promise<{ messageId: string; success: boolean }> {
        // No template engine is implemented yet; fail loudly rather than
        // silently sending a placeholder body that looks like a real send.
        throw new Error("sendTemplate not supported by sendgrid");
    }
}
