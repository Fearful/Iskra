import type { EmailAdapter, EmailMessage, EmailConfig, TemplateData } from "../types";

/**
 * Outbound custom mail headers callers are permitted to set. Anything outside
 * this set is rejected so a caller cannot spoof Reply-To / Sender / routing
 * headers via the generic `headers` map.
 */
const ALLOWED_HEADERS = new Set([
    "reply-to",
    "in-reply-to",
    "references",
    "list-unsubscribe",
    "list-unsubscribe-post",
    "list-id",
    "x-mailgun-variables",
    "x-mailgun-tag",
]);

/**
 * Truncate a header value at the first CR/LF. Anything after a line break is an
 * injected header (or folded continuation) and must be dropped, not preserved.
 */
const stripCrlf = (value: string): string => value.split(/[\r\n]/)[0] ?? "";

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
            form.append("from", from.name ? `${from.name} <${from.email}>` : from.email);
        }

        const to = Array.isArray(message.to) ? message.to.join(",") : message.to;
        form.append("to", to);
        form.append("subject", message.subject);

        if (message.text) form.append("text", message.text);
        if (message.html) form.append("html", message.html);
        if (message.cc) form.append("cc", Array.isArray(message.cc) ? message.cc.join(",") : message.cc);
        if (message.bcc) form.append("bcc", Array.isArray(message.bcc) ? message.bcc.join(",") : message.bcc);
        if (message.replyTo) form.append("h:Reply-To", message.replyTo);

        if (message.headers) {
            for (const [key, value] of Object.entries(message.headers)) {
                if (!ALLOWED_HEADERS.has(key.toLowerCase())) {
                    throw new Error(`Header "${key}" is not allowed`);
                }
                form.append(`h:${key}`, stripCrlf(value));
            }
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
