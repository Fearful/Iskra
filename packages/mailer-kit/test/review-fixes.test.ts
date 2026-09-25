import { afterAll, describe, expect, it } from 'bun:test';
import * as nodemailer from 'nodemailer';
import { SendGridEmailAdapter } from '../src/providers/sendgrid';
import { SmtpEmailAdapter } from '../src/providers/smtp';
import { SesEmailAdapter } from '../src/providers/ses';
import { MailgunEmailAdapter } from '../src/providers/mailgun';
import { formatAddress } from '../src/headers';

const requests: Array<{ auth: string | null; body: any }> = [];
const sendgrid = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(req) {
        requests.push({ auth: req.headers.get('authorization'), body: await req.json() });
        return new Response('', { status: 202, headers: { 'x-message-id': 'mid' } });
    },
});
afterAll(() => sendgrid.stop(true));

function sendgridAdapter(apiKey: string) {
    const adapter = new SendGridEmailAdapter({ provider: 'sendgrid', apiKey, from: { email: 'a@example.com' } });
    (adapter as any).client.client.setDefaultRequest('baseUrl', `http://127.0.0.1:${sendgrid.port}/`);
    return adapter;
}

describe('SendGrid', () => {
    it("keeps each adapter's API key (the default client is process-wide)", async () => {
        requests.length = 0;
        const tenantA = sendgridAdapter('SG.tenantA');
        const tenantB = sendgridAdapter('SG.tenantB');
        await tenantA.send({ to: 'x@example.com', subject: 's', text: 't' });
        await tenantB.send({ to: 'x@example.com', subject: 's', text: 't' });
        expect(requests.map((r) => r.auth)).toEqual(['Bearer SG.tenantA', 'Bearer SG.tenantB']);
    });

    it('base64-encodes a string attachment and forwards allowed headers', async () => {
        requests.length = 0;
        await sendgridAdapter('SG.k').send({
            to: 'x@example.com',
            subject: 's',
            text: 't',
            attachments: [{ filename: 'n.txt', content: 'hello world' }],
            headers: { 'List-Unsubscribe': '<https://example.com/u>\r\nBcc: evil@example.com' },
        });
        const body = requests[0]!.body;
        expect(Buffer.from(body.attachments[0].content, 'base64').toString()).toBe('hello world');
        expect(body.headers).toEqual({ 'List-Unsubscribe': '<https://example.com/u>' });
        await expect(
            sendgridAdapter('SG.k').send({ to: 'x@example.com', subject: 's', text: 't', headers: { Sender: 'x' } }),
        ).rejects.toThrow(/not allowed/);
    });
});

describe('SMTP', () => {
    function smtpAdapter() {
        const adapter: any = new SmtpEmailAdapter({
            provider: 'smtp',
            smtp: { host: 'h', port: 587, username: 'u', password: 'p' },
            from: { email: 'noreply@example.com' },
        });
        adapter.transporter = ((nodemailer as any).default ?? nodemailer).createTransport({
            streamTransport: true,
            buffer: true,
        });
        const sent: string[] = [];
        const sendMail = adapter.transporter.sendMail.bind(adapter.transporter);
        adapter.transporter.sendMail = async (opts: unknown) => {
            const info = await sendMail(opts);
            sent.push(info.message.toString());
            return info;
        };
        return { adapter, sent };
    }

    it('does not let a display name add another sender', async () => {
        const { adapter, sent } = smtpAdapter();
        await adapter.send({
            from: { name: 'Ana" <ceo@victim-bank.com>, "x', email: 'noreply@example.com' },
            to: 'u@example.com',
            subject: 'hi',
            text: 't',
        });
        const fromHeader = sent[0]!.split('\r\n').find((l) => l.startsWith('From:'))!;
        // One mailbox: the whole name is one quoted string. Interpolated into
        // `"name" <email>`, it closed the quotes and added ceo@victim-bank.com.
        expect(fromHeader).toBe('From: "Ana\\" <ceo@victim-bank.com>, \\"x" <noreply@example.com>');
    });

    it('forwards allowed headers and rejects others', async () => {
        const { adapter, sent } = smtpAdapter();
        await adapter.send({
            to: 'u@example.com',
            subject: 'hi',
            text: 't',
            headers: { 'List-Unsubscribe': '<https://example.com/u>' },
        });
        expect(sent[0]).toContain('List-Unsubscribe: <https://example.com/u>');
        await expect(
            adapter.send({ to: 'u@example.com', subject: 's', text: 't', headers: { 'X-Custom': 'v' } }),
        ).rejects.toThrow(/not allowed/);
    });
});

describe('SES', () => {
    function sesAdapter() {
        const inputs: any[] = [];
        const adapter = new SesEmailAdapter(
            { provider: 'ses', region: 'us-east-1', from: { email: 'n@example.com', name: 'José Pérez' } },
            {
                client: {
                    send: async (c: any) => {
                        inputs.push(c.input);
                        return { MessageId: 'm' };
                    },
                },
                sendEmailCommand: (input) => ({ input }),
            },
        );
        return { adapter, inputs };
    }

    it('fails instead of silently dropping attachments or headers', async () => {
        const { adapter, inputs } = sesAdapter();
        await expect(
            adapter.send({
                to: 'u@example.com',
                subject: 's',
                text: 't',
                attachments: [{ filename: 'f.pdf', content: new Uint8Array([1]) }],
            }),
        ).rejects.toThrow(/Attachments are not supported/);
        await expect(
            adapter.send({ to: 'u@example.com', subject: 's', text: 't', headers: { 'List-Unsubscribe': '<x>' } }),
        ).rejects.toThrow(/headers are not supported/);
        expect(inputs).toEqual([]);
    });

    it('encodes a non-ASCII display name', async () => {
        const { adapter, inputs } = sesAdapter();
        await adapter.send({ to: 'u@example.com', subject: 's', text: 't' });
        expect(inputs[0].FromEmailAddress).toBe(
            `=?UTF-8?B?${Buffer.from('José Pérez').toString('base64')}?= <n@example.com>`,
        );
    });
});

describe('formatAddress', () => {
    it('quotes special characters and rejects a malformed address', () => {
        expect(formatAddress({ name: 'Test Sender', email: 'a@example.com' })).toBe('Test Sender <a@example.com>');
        expect(formatAddress({ name: 'Ana" <ceo@bank.com>, "x', email: 'a@example.com' })).toBe(
            '"Ana\\" <ceo@bank.com>, \\"x" <a@example.com>',
        );
        expect(formatAddress({ name: 'Line\r\nBcc: x@y.com', email: 'a@example.com' })).toBe(
            '"Line Bcc: x@y.com" <a@example.com>',
        );
        expect(() => formatAddress({ email: 'a@example.com>, b@evil.com' })).toThrow(/Invalid email/);
    });

    it('is used by Mailgun', async () => {
        const forms: FormData[] = [];
        const realFetch = globalThis.fetch;
        globalThis.fetch = (async (_url: unknown, init: any) => {
            forms.push(init.body);
            return new Response(JSON.stringify({ id: 'id', message: 'ok' }), { status: 200 });
        }) as typeof fetch;
        try {
            const mailgun = new MailgunEmailAdapter({ provider: 'mailgun', apiKey: 'k', domain: 'mg.example.com' });
            await mailgun.send({
                from: { name: 'A" <x@evil.com>', email: 'a@example.com' },
                to: 'u@example.com',
                subject: 's',
                text: 't',
            });
        } finally {
            globalThis.fetch = realFetch;
        }
        expect(forms[0]!.get('from')).toBe('"A\\" <x@evil.com>" <a@example.com>');
    });
});
