import type { EmailAdapter, EmailMessage, EmailRecipient, TemplateData } from './types';
import { checkRecipients, checkReplyTo } from './headers';

/**
 * In-memory email adapter used for tests and local development.
 * It performs no network I/O and stays silent (no stdout) so it is
 * safe to use inside library code and background workers.
 */
export class MockEmailAdapter implements EmailAdapter {
    async send(message: EmailMessage) {
        // Checked like the real providers, so a test fails where production would.
        checkRecipients(message.to);
        checkRecipients(message.cc, 'cc recipient');
        checkRecipients(message.bcc, 'bcc recipient');
        checkReplyTo(message.replyTo);
        return { messageId: `mock-${Date.now()}`, success: true };
    }

    async sendTemplate(name: string, to: EmailRecipient | EmailRecipient[], data: TemplateData) {
        return this.send({
            to,
            subject: `Template: ${name}`,
            html: `Template ${name} with data: ${JSON.stringify(data)}`,
        });
    }
}
