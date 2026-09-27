import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import * as nodemailer from 'nodemailer';
import { checkRecipients, MockEmailAdapter } from '../src';
import { SmtpEmailAdapter } from '../src/providers/smtp';
import { MailgunEmailAdapter } from '../src/providers/mailgun';
import { SesEmailAdapter } from '../src/providers/ses';
import { SendGridEmailAdapter } from '../src/providers/sendgrid';

// Only `from` was checked: one `to`/`cc`/`bcc` value such as
// "bob@example.com <attacker@evil.test>, x@example.com" or a group
// "undisclosed: a@evil.test; b@x.com" mailed other people than the address an
// allowlist had checked, and { address: "bob@example.com\r\nBcc: …" } reached
// nodemailer, which mailed "bob@example.com Bcc: spy"@evil.test.

const SMUGGLING: unknown[] = [
    'bob@example.com <attacker@evil.test>, x@example.com',
    'undisclosed: a@evil.test; b@x.com',
    'undisclosed:a@evil.test;',
    'a@evil.test:b@example.com',
    'bob@example.com(attacker@evil.test)',
    'a@example.com,b@evil.test',
    'bob@example.com\r\nBcc: spy@evil.test',
    { address: 'bob@example.com\r\nBcc: spy@evil.test' },
    { address: 'bob@example.com, spy@evil.test' },
    { name: 'Bob\r\nBcc: spy@evil.test', address: 'bob@example.com' },
    { name: 'Bob' },
    'bob',
    '@example.com',
    'bob@',
    '',
    42,
];

describe('checkRecipients', () => {
    it('rejects anything but one bare address per entry', () => {
        for (const value of SMUGGLING) {
            expect(() => checkRecipients(value as any)).toThrow(/Invalid/);
            expect(() => checkRecipients(['ok@example.com', value] as any)).toThrow(/Invalid/);
        }
    });

    it('accepts bare addresses and { name, address } objects', () => {
        expect(checkRecipients(' a@example.com ')).toEqual([{ address: 'a@example.com' }]);
        expect(checkRecipients(['josé@ejemplo.es', { name: 'Ana, "CEO" <x@y>', address: 'ana@example.com' }])).toEqual([
            { address: 'josé@ejemplo.es' },
            { name: 'Ana, "CEO" <x@y>', address: 'ana@example.com' },
        ]);
        expect(checkRecipients(undefined)).toEqual([]);
        // An absent optional field may arrive as null; a null entry is invalid.
        expect(checkRecipients(null as any)).toEqual([]);
        expect(() => checkRecipients(['ok@example.com', null] as any)).toThrow(/Invalid/);
    });
});

describe('providers check every recipient', () => {
    let restore: Array<() => void> = [];
    afterEach(() => {
        for (const r of restore) r();
        restore = [];
    });

    function smtp() {
        const adapter: any = new SmtpEmailAdapter({
            provider: 'smtp',
            smtp: { host: 'h', port: 587, username: 'u', password: 'p' },
            from: { email: 'noreply@example.com' },
        });
        adapter.transporter = ((nodemailer as any).default ?? nodemailer).createTransport({
            streamTransport: true,
            buffer: true,
        });
        const sent: Array<{ envelope: any; message: string }> = [];
        const sendMail = adapter.transporter.sendMail.bind(adapter.transporter);
        adapter.transporter.sendMail = async (opts: unknown) => {
            const info = await sendMail(opts);
            sent.push({ envelope: info.envelope, message: info.message.toString() });
            return info;
        };
        return { adapter: adapter as SmtpEmailAdapter, sent };
    }

    function mailgun() {
        const forms: FormData[] = [];
        const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (_url: unknown, init: any) => {
            forms.push(init.body);
            return new Response(JSON.stringify({ id: 'id', message: 'ok' }), { status: 200 });
        }) as any);
        restore.push(() => fetchSpy.mockRestore());
        const adapter = new MailgunEmailAdapter({
            provider: 'mailgun',
            apiKey: 'k',
            domain: 'mg.example.com',
            from: { email: 'noreply@example.com' },
        });
        return { adapter, forms };
    }

    function ses() {
        const inputs: any[] = [];
        const adapter = new SesEmailAdapter(
            { provider: 'ses', region: 'us-east-1', from: { email: 'noreply@example.com' } },
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

    function sendgrid() {
        const adapter = new SendGridEmailAdapter({
            provider: 'sendgrid',
            apiKey: 'SG.k',
            from: { email: 'noreply@example.com' },
        });
        const bodies: any[] = [];
        (adapter as any).client.send = async (msg: any) => {
            bodies.push(msg);
            return [{ headers: { 'x-message-id': 'mid' } }];
        };
        return { adapter, bodies };
    }

    it('refuses a smuggled recipient in to, cc, bcc and replyTo before sending', async () => {
        const s = smtp();
        const m = mailgun();
        const a = ses();
        const g = sendgrid();
        const adapters = [s.adapter, m.adapter, a.adapter, g.adapter, new MockEmailAdapter()];
        const value = 'bob@example.com <attacker@evil.test>, x@example.com';
        const object = { address: 'bob@example.com\r\nBcc: spy@evil.test' };
        for (const adapter of adapters) {
            for (const message of [
                { to: value },
                { to: 'ok@example.com', cc: [value] },
                { to: 'ok@example.com', bcc: object },
                { to: object },
                { to: 'ok@example.com', replyTo: 'x@evil.test, y@evil.test' },
                { to: 'ok@example.com', replyTo: { address: 'r@example.com\nBcc: spy@evil.test' } },
            ]) {
                await expect(adapter.send({ subject: 's', text: 't', ...(message as any) })).rejects.toThrow(/Invalid/);
            }
        }
        expect([s.sent.length, m.forms.length, a.inputs.length, g.bodies.length]).toEqual([0, 0, 0, 0]);
    });

    it('sends a display name as its own quoted mailbox', async () => {
        const recipients = {
            to: [{ name: 'Bob, <spy@evil.test>', address: 'bob@example.com' }, 'x@example.com'],
            cc: { name: 'Ana', address: 'ana@example.com' },
            replyTo: { name: 'Support', address: 'help@example.com' },
        };

        const s = smtp();
        await s.adapter.send({ subject: 's', text: 't', ...recipients });
        expect(s.sent[0]!.envelope.to).toEqual(['bob@example.com', 'x@example.com', 'ana@example.com']);
        expect(s.sent[0]!.message).toContain('To: "Bob, <spy@evil.test>" <bob@example.com>, x@example.com');
        expect(s.sent[0]!.message).toContain('Reply-To: Support <help@example.com>');

        const m = mailgun();
        await m.adapter.send({ subject: 's', text: 't', ...recipients });
        expect(m.forms[0]!.get('to')).toBe('"Bob, <spy@evil.test>" <bob@example.com>,x@example.com');
        expect(m.forms[0]!.get('cc')).toBe('Ana <ana@example.com>');
        expect(m.forms[0]!.get('h:Reply-To')).toBe('Support <help@example.com>');

        const a = ses();
        await a.adapter.send({ subject: 's', text: 't', ...recipients });
        expect(a.inputs[0].Destination.ToAddresses).toEqual([
            '"Bob, <spy@evil.test>" <bob@example.com>',
            'x@example.com',
        ]);
        expect(a.inputs[0].ReplyToAddresses).toEqual(['Support <help@example.com>']);

        const g = sendgrid();
        await g.adapter.send({ subject: 's', text: 't', ...recipients });
        expect(g.bodies[0].to).toEqual([{ email: 'bob@example.com', name: 'Bob, <spy@evil.test>' }, 'x@example.com']);
        expect(g.bodies[0].replyTo).toEqual({ email: 'help@example.com', name: 'Support' });
    });
});

describe('Mailgun subject and Reply-To', () => {
    afterEach(() => {
        (globalThis.fetch as any).mockRestore?.();
    });

    it('keeps CR/LF out of the subject', async () => {
        const forms: FormData[] = [];
        spyOn(globalThis, 'fetch').mockImplementation((async (_url: unknown, init: any) => {
            forms.push(init.body);
            return new Response(JSON.stringify({ id: 'id', message: 'ok' }), { status: 200 });
        }) as any);
        const adapter = new MailgunEmailAdapter({
            provider: 'mailgun',
            apiKey: 'k',
            domain: 'mg.example.com',
            from: { email: 'noreply@example.com' },
        });
        await adapter.send({ to: 'u@example.com', subject: 'Hi\r\nBcc: spy@evil.test', text: 't' });
        expect(forms[0]!.get('subject')).toBe('Hi');
    });
});
