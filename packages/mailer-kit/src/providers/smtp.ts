import type { EmailAdapter, EmailConfig, EmailMessage, TemplateData } from '../types';
import * as nodemailer from 'nodemailer';
import { checkEmail, checkHeaders, cleanName } from '../headers';

export class SmtpEmailAdapter implements EmailAdapter {
    private transporter: nodemailer.Transporter;

    constructor(private config: EmailConfig) {
        if (!config.smtp) throw new Error('SMTP config required');
        // Implicit TLS on port 465; STARTTLS enforced (requireTLS) elsewhere so
        // credentials never transit in cleartext. An explicit `secure` wins.
        const secure = config.smtp.secure ?? config.smtp.port === 465;
        this.transporter = nodemailer.createTransport({
            host: config.smtp.host,
            port: config.smtp.port,
            secure,
            requireTLS: secure ? undefined : true,
            tls: { rejectUnauthorized: true },
            auth: {
                user: config.smtp.username,
                pass: config.smtp.password,
            },
        });
    }

    async send(message: EmailMessage) {
        const from = message.from || this.config.from;
        if (!from) throw new Error('From address required');

        const info = await this.transporter.sendMail({
            // An address object: nodemailer quotes or encodes the name, which
            // interpolated into `"name" <email>` could add another sender.
            from: { name: from.name ? cleanName(from.name) : '', address: checkEmail(from.email) },
            to: Array.isArray(message.to) ? message.to.join(', ') : message.to,
            subject: message.subject,
            text: message.text,
            html: message.html,
            cc: message.cc ? (Array.isArray(message.cc) ? message.cc.join(', ') : message.cc) : undefined,
            bcc: message.bcc ? (Array.isArray(message.bcc) ? message.bcc.join(', ') : message.bcc) : undefined,
            replyTo: message.replyTo,
            attachments: message.attachments?.map((a) => ({
                filename: a.filename,
                content: typeof a.content === 'string' ? a.content : Buffer.from(a.content),
                contentType: a.contentType,
            })),
            // Forwarded with the same allowlist as the other providers (it
            // used to be dropped).
            headers: checkHeaders(message.headers),
        });

        return { messageId: info.messageId, success: true };
    }

    async sendTemplate(
        _templateName: string,
        _to: string | string[],
        _data: TemplateData,
    ): Promise<{ messageId: string; success: boolean }> {
        // No template engine is implemented yet; fail loudly rather than
        // silently sending a placeholder body that looks like a real send.
        throw new Error('sendTemplate not supported by smtp');
    }
}
