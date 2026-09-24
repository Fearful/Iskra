import type { EmailAdapter, EmailMessage, EmailConfig, TemplateData } from "../types";
import { ALLOWED_HEADERS, checkHeaders, formatAddress } from "../headers";

/** Mailgun's own headers, on top of the ones every provider allows. */
const MAILGUN_HEADERS = [...ALLOWED_HEADERS, "x-mailgun-variables", "x-mailgun-tag"];

export class MailgunEmailAdapter implements EmailAdapter {
    private apiKey: string;
    private domain: string;
    private baseUrl: string;
    private defaultFrom?: { name?: string; email: string };

    constructor(config: EmailConfig) {
        if (!config.apiKey) throw new Error("Mailgun requires apiKey");
        if (!config.domain) throw new Error("Mailgun requires domain");

        this.apiKey = config.apiKey;
        this.domain = config.domain;
        this.baseUrl = config.baseUrl || "https://api.mailgun.net/v3";
        this.defaultFrom = config.from;
    }

    async send(message: EmailMessage): Promise<{ messageId: string; success: boolean }> {
        const form = new FormData();

        const from = message.from || this.defaultFrom;
        if (from) {
            form.append("from", formatAddress(from));
        }

        const to = Array.isArray(message.to) ? message.to.join(",") : message.to;
        form.append("to", to);
        form.append("subject", message.subject);

        if (message.text) form.append("text", message.text);
        if (message.html) form.append("html", message.html);
        if (message.cc) form.append("cc", Array.isArray(message.cc) ? message.cc.join(",") : message.cc);
        if (message.bcc) form.append("bcc", Array.isArray(message.bcc) ? message.bcc.join(",") : message.bcc);
        if (message.replyTo) form.append("h:Reply-To", message.replyTo);

        for (const [key, value] of Object.entries(checkHeaders(message.headers, MAILGUN_HEADERS) ?? {})) {
            form.append(`h:${key}`, value);
        }

        if (message.attachments) {
            for (const att of message.attachments) {
                const content = typeof att.content === "string"
                    ? new TextEncoder().encode(att.content)
                    : att.content;
                const bytes = new Uint8Array(content);
                const blob = new Blob([bytes], { type: att.contentType || "application/octet-stream" });
                form.append("attachment", blob, att.filename);
            }
        }

        const response = await fetch(`${this.baseUrl}/${this.domain}/messages`, {
            method: "POST",
            headers: {
                Authorization: "Basic " + btoa(`api:${this.apiKey}`),
            },
            body: form,
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Mailgun API error (${response.status}): ${errorText}`);
        }

        const result = await response.json() as { id: string; message: string };
        return { messageId: result.id, success: true };
    }

    async sendTemplate(_templateName: string, _to: string | string[], _data: TemplateData): Promise<{ messageId: string; success: boolean }> {
        // No template engine is implemented yet; fail loudly rather than
        // silently sending a placeholder that looks like a real send.
        throw new Error("sendTemplate not supported by mailgun");
    }
}
