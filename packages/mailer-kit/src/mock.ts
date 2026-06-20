import type { EmailAdapter, EmailMessage, TemplateData } from "./types";

/**
 * In-memory email adapter used for tests and local development.
 * It performs no network I/O and stays silent (no stdout) so it is
 * safe to use inside library code and background workers.
 */
export class MockEmailAdapter implements EmailAdapter {
    async send(_message: EmailMessage) {
        return { messageId: `mock-${Date.now()}`, success: true };
    }

    async sendTemplate(name: string, to: string | string[], data: TemplateData) {
        return this.send({ to, subject: `Template: ${name}`, html: `Template ${name} with data: ${JSON.stringify(data)}` });
    }
}
