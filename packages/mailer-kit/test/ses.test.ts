import { describe, expect, it } from 'bun:test';
import { SesEmailAdapter, type SesClient, type SesCommand } from '../src/providers/ses';

/**
 * These tests inject a structural mock client and command factory, so the
 * real `@aws-sdk/client-sesv2` is never imported. This keeps the suite green
 * even when the SDK is not installed.
 */
describe('SesEmailAdapter', () => {
    function makeMocks() {
        const sent: SesCommand[] = [];
        const client: SesClient = {
            async send(command) {
                sent.push(command);
                return { MessageId: 'ses-message-id-123' };
            },
        };
        const sendEmailCommand = (input: unknown): SesCommand => ({ input });
        return { sent, client, sendEmailCommand };
    }

    it('builds a SendEmailCommand input correctly and resolves { messageId, success }', async () => {
        const { sent, client, sendEmailCommand } = makeMocks();
        const adapter = new SesEmailAdapter(
            { provider: 'ses', region: 'us-east-1', from: { email: 'no-reply@iskra.dev', name: 'Iskra' } },
            { client, sendEmailCommand },
        );

        const result = await adapter.send({
            to: ['a@example.com', 'b@example.com'],
            subject: 'Hola',
            text: 'Cuerpo',
            html: '<p>Cuerpo</p>',
            cc: 'cc@example.com',
            bcc: ['bcc1@example.com', 'bcc2@example.com'],
            replyTo: 'reply@example.com',
        });

        expect(result).toEqual({ messageId: 'ses-message-id-123', success: true });
        expect(sent).toHaveLength(1);

        const input = sent[0]!.input as any;
        expect(input.FromEmailAddress).toBe('Iskra <no-reply@iskra.dev>');
        expect(input.Destination.ToAddresses).toEqual(['a@example.com', 'b@example.com']);
        expect(input.Destination.CcAddresses).toEqual(['cc@example.com']);
        expect(input.Destination.BccAddresses).toEqual(['bcc1@example.com', 'bcc2@example.com']);
        expect(input.ReplyToAddresses).toEqual(['reply@example.com']);
        expect(input.Content.Simple.Subject.Data).toBe('Hola');
        expect(input.Content.Simple.Body.Text.Data).toBe('Cuerpo');
        expect(input.Content.Simple.Body.Html.Data).toBe('<p>Cuerpo</p>');
    });

    it("uses a bare email when 'from' has no name and omits empty destination fields", async () => {
        const { sent, client, sendEmailCommand } = makeMocks();
        const adapter = new SesEmailAdapter(
            { provider: 'ses', from: { email: 'plain@iskra.dev' } },
            { client, sendEmailCommand },
        );

        await adapter.send({ to: 'x@example.com', subject: 's', text: 't' });

        const input = sent[0]!.input as any;
        expect(input.FromEmailAddress).toBe('plain@iskra.dev');
        expect(input.Destination.ToAddresses).toEqual(['x@example.com']);
        expect(input.Destination.CcAddresses).toBeUndefined();
        expect(input.Destination.BccAddresses).toBeUndefined();
        expect(input.ReplyToAddresses).toBeUndefined();
        expect(input.Content.Simple.Body.Html).toBeUndefined();
    });

    it('throws when no from address is available', async () => {
        const { client, sendEmailCommand } = makeMocks();
        const adapter = new SesEmailAdapter({ provider: 'ses' }, { client, sendEmailCommand });

        await expect(adapter.send({ to: 'x@example.com', subject: 's', text: 't' })).rejects.toThrow(
            'From address required',
        );
    });

    it('sendTemplate() throws instead of silently sending a placeholder', async () => {
        const { sent, client, sendEmailCommand } = makeMocks();
        const adapter = new SesEmailAdapter(
            { provider: 'ses', from: { email: 'no-reply@iskra.dev' } },
            { client, sendEmailCommand },
        );

        await expect(adapter.sendTemplate('welcome', 'user@example.com', { name: 'Ada' })).rejects.toThrow(
            'sendTemplate not supported by ses',
        );
        expect(sent).toHaveLength(0);
    });
});
