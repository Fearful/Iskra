import { describe, expect, it, mock } from 'bun:test';
import { SesEmailAdapter } from '../src/providers/ses';

// Replaces the SES SDK with a fake that counts the clients it builds. Only
// the SES adapter imports this module, and every other SES test injects its
// own client, so the process-wide mock does not reach them.
let clientsBuilt = 0;
const sentBy: object[] = [];
mock.module('@aws-sdk/client-sesv2', () => ({
    SESv2Client: class {
        constructor(_cfg: { region?: string }) {
            clientsBuilt++;
        }
        async send(_command: unknown) {
            sentBy.push(this);
            return { MessageId: `id-${sentBy.length}` };
        }
    },
    SendEmailCommand: class {
        constructor(public input: unknown) {}
    },
}));

describe('SesEmailAdapter client reuse', () => {
    it('builds one SESv2Client for every send of an adapter', async () => {
        clientsBuilt = 0;
        sentBy.length = 0;
        const adapter = new SesEmailAdapter({ provider: 'ses', region: 'us-east-1', from: { email: 'n@example.com' } });

        await adapter.send({ to: 'a@example.com', subject: 's', text: 't' });
        await adapter.send({ to: 'b@example.com', subject: 's', text: 't' });

        expect(clientsBuilt).toBe(1);
        expect(sentBy).toHaveLength(2);
        expect(sentBy[0]).toBe(sentBy[1]!);
    });

    it('retries the SDK load after a failed one instead of caching the failure', async () => {
        const adapter = new SesEmailAdapter({ provider: 'ses', from: { email: 'n@example.com' } });
        const client = { send: async () => ({ MessageId: 'ok' }) };
        let loads = 0;
        (adapter as any).loadSdk = async () => {
            loads++;
            if (loads === 1) throw new Error('Cannot find package @aws-sdk/client-sesv2');
            return { client, command: (input: unknown) => ({ input }) };
        };

        await expect(adapter.send({ to: 'a@example.com', subject: 's', text: 't' })).rejects.toThrow(
            'Cannot find package',
        );
        expect(await adapter.send({ to: 'a@example.com', subject: 's', text: 't' })).toEqual({
            messageId: 'ok',
            success: true,
        });
        await adapter.send({ to: 'a@example.com', subject: 's', text: 't' });
        expect(loads).toBe(2);
    });
});
