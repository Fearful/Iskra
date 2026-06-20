import type { EmailAdapter, EmailConfig, EmailMessage, TemplateData } from "../types";
import * as nodemailer from "nodemailer";

export class SmtpEmailAdapter implements EmailAdapter {
    private transporter: nodemailer.Transporter;

    constructor(private config: EmailConfig) {
        if (!config.smtp) throw new Error("SMTP config required");
        this.transporter = nodemailer.createTransport({
            host: config.smtp.host,
            port: config.smtp.port,
            secure: config.smtp.secure ?? false,
            auth: {
                user: config.smtp.username,
                pass: config.smtp.password
            }
        });
    }

    async send(message: EmailMessage) {
        const from = message.from || this.config.from;
        if (!from) throw new Error("From address required");

        const info = await this.transporter.sendMail({
            from: from.name ? `"${from.name}" <${from.email}>` : from.email,
            to: Array.isArray(message.to) ? message.to.join(", ") : message.to,
            subject: message.subject,
            text: message.text,
            html: message.html,
            cc: message.cc ? (Array.isArray(message.cc) ? message.cc.join(", ") : message.cc) : undefined,
            bcc: message.bcc ? (Array.isArray(message.bcc) ? message.bcc.join(", ") : message.bcc) : undefined,
            replyTo: message.replyTo,
            attachments: message.attachments?.map(a => ({
                filename: a.filename,
                content: typeof a.content === 'string' ? a.content : Buffer.from(a.content),
                contentType: a.contentType
            }))
        });

        return { messageId: (info as any).messageId, success: true };
    }

    async sendTemplate(templateName: string, to: string | string[], data: TemplateData) {
        // Simple mock template engine
        return this.send({
            to,
            subject: `Template: ${templateName}`,
            html: `<p>Template ${templateName} rendered with ${JSON.stringify(data)}</p>`
        });
    }
}
