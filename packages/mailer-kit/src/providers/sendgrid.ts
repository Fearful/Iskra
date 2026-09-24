import type { EmailAdapter, EmailConfig, EmailMessage, TemplateData } from "../types";
import { MailService } from "@sendgrid/mail";
import { checkEmail, checkHeaders, cleanName } from "../headers";

export class SendGridEmailAdapter implements EmailAdapter {
    /**
     * A client per adapter: the package's default export is a process-wide
     * singleton, so the last adapter created set the API key for all of them
     * (one tenant's mail sent with another tenant's account).
     */
    private readonly client = new MailService();

    constructor(private config: EmailConfig) {
        if (!config.apiKey) throw new Error("SendGrid API Key required");
        this.client.setApiKey(config.apiKey);
    }

    async send(message: EmailMessage) {
        const from = message.from || this.config.from;
        if (!from) throw new Error("From address required");

        const msg = {
            to: message.to,
            from: from.name ? { email: checkEmail(from.email), name: cleanName(from.name) } : checkEmail(from.email),
            subject: message.subject,
            text: message.text,
            html: message.html,
            cc: message.cc as any,
            bcc: message.bcc as any,
            replyTo: message.replyTo,
            attachments: message.attachments?.map(a => ({
                filename: a.filename,
                // SendGrid takes base64; a string is text, as with the other
                // providers (it was sent as is and arrived corrupted).
                content: Buffer.from(typeof a.content === 'string' ? Buffer.from(a.content, "utf8") : a.content).toString("base64"),
                type: a.contentType,
                disposition: "attachment"
            })),
            headers: checkHeaders(message.headers),
        } as any;

        const [response] = await this.client.send(msg);
        return { messageId: response.headers["x-message-id"] as string, success: true };
    }

    async sendTemplate(_templateName: string, _to: string | string[], _data: TemplateData): Promise<{ messageId: string; success: boolean }> {
        // No template engine is implemented yet; fail loudly rather than
        // silently sending a placeholder body that looks like a real send.
        throw new Error("sendTemplate not supported by sendgrid");
    }
}
