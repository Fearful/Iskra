import { describe, expect, it } from 'bun:test';
import { Kernel } from '../src/kernel';
import { EmailFeature } from '../src/features/email';

// The wrapper only rejected CR/LF, tested on String(recipient): an object
// recipient passed untested ("[object Object]"), and one value could name a
// list or a group of recipients.

async function adapter() {
    const kernel = new Kernel();
    const email = new EmailFeature({ provider: 'mock' });
    kernel.registerFeature(email);
    await kernel.initialize();
    return { kernel, email: email.getAdapter() };
}

describe('EmailFeature recipient validation', () => {
    it('rejects object recipients carrying CR/LF and values naming several recipients', async () => {
        const { kernel, email } = await adapter();
        const invalid: unknown[] = [
            { address: 'bob@example.com\r\nBcc: spy@evil.test' },
            { name: 'Bob\r\nBcc: spy@evil.test', address: 'bob@example.com' },
            'bob@example.com <attacker@evil.test>, x@example.com',
            'undisclosed: a@evil.test; b@example.com',
            'a@evil.test:b@example.com',
        ];
        for (const value of invalid) {
            await expect(email.send({ to: value as any, subject: 's', text: 't' })).rejects.toThrow(/Invalid/);
            await expect(email.send({ to: 'ok@example.com', cc: [value as any], subject: 's' })).rejects.toThrow(
                /Invalid/,
            );
            await expect(email.send({ to: 'ok@example.com', replyTo: value as any, subject: 's' })).rejects.toThrow(
                /Invalid/,
            );
            await expect(email.sendTemplate('welcome', value as any, {})).rejects.toThrow(/Invalid/);
        }
        await kernel.shutdown();
    });

    it('sends to bare addresses and { name, address } recipients', async () => {
        const { kernel, email } = await adapter();
        const result = await email.send({
            to: [{ name: 'Ana', address: 'ana@example.com' }, 'bob@example.com'],
            bcc: 'audit@example.com',
            replyTo: { name: 'Support', address: 'help@example.com' },
            subject: 's',
            text: 't',
        });
        expect(result.success).toBe(true);
        await kernel.shutdown();
    });
});
