import type { EmailAdapter, EmailConfig } from "./types";
import { MockEmailAdapter } from "./mock";

/**
 * Builds the email adapter for the given provider. Providers are loaded
 * lazily via dynamic `import()` so an app only pays for (and only needs
 * installed) the SDK of the provider it actually uses.
 */
export async function createEmailAdapter(config: EmailConfig): Promise<EmailAdapter> {
    switch (config.provider) {
        case "mock":
            return new MockEmailAdapter();
        case "smtp": {
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
        case "ses": {
            const { SesEmailAdapter } = await import("./providers/ses");
            return new SesEmailAdapter(config);
        }
        default:
            throw new Error(`Provider ${config.provider} not implemented`);
    }
}
