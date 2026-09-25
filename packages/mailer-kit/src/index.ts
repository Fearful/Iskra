export type { EmailConfig, EmailMessage, EmailAddress, EmailRecipient, TemplateData, EmailAdapter } from './types';
export { checkRecipients, checkReplyTo } from './headers';
export { MockEmailAdapter } from './mock';
export { createEmailAdapter } from './factory';
export { SmtpEmailAdapter } from './providers/smtp';
export { SendGridEmailAdapter } from './providers/sendgrid';
export { MailgunEmailAdapter } from './providers/mailgun';
export { SesEmailAdapter } from './providers/ses';
export type { SesClient, SesCommand, SesCommandFactory, SesAdapterDeps } from './providers/ses';
