import { describe, expect, it, afterEach, spyOn } from 'bun:test';
import { MailgunEmailAdapter } from '../src/providers/mailgun';

describe('MailgunEmailAdapter', () => {
    it('instantiates with required config', () => {
        const adapter = new MailgunEmailAdapter({
            provider: 'mailgun',
            apiKey: 'key-12345',
            domain: 'test.mailgun.org',
            from: { email: 'noreply@test.com', name: 'Test' },
        });
        expect(adapter).toBeDefined();
    });

    it('throws without apiKey', () => {
        try {
            new MailgunEmailAdapter({ provider: 'mailgun' } as any);
            expect(true).toBe(false);
        } catch (err) {
            expect((err as Error).message).toContain('apiKey');
        }
    });

    it('throws without domain', () => {
        try {
            new MailgunEmailAdapter({ provider: 'mailgun', apiKey: 'key' } as any);
            expect(true).toBe(false);
        } catch (err) {
            expect((err as Error).message).toContain('domain');
        }
    });
});

describe('MailgunEmailAdapter send/sendTemplate (fetch mocked)', () => {
    let fetchSpy: ReturnType<typeof spyOn> | null = null;

    afterEach(() => {
        fetchSpy?.mockRestore();
        fetchSpy = null;
    });

    function mockFetch(response: Response) {
        fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(response) as any;
    }

    const makeAdapter = () =>
        new MailgunEmailAdapter({
            provider: 'mailgun',
            apiKey: 'key-12345',
            domain: 'test.mailgun.org',
            from: { email: 'noreply@test.com', name: 'Test Sender' },
        });

    it('posts to the Mailgun messages endpoint with auth and a fully built form', async () => {
        mockFetch(new Response(JSON.stringify({ id: '<msg-1>', message: 'Queued' }), { status: 200 }));

        const result = await makeAdapter().send({
            to: ['a@example.com', 'b@example.com'],
            subject: 'Hello',
            text: 'Body text',
            html: '<p>Body</p>',
            cc: 'cc@example.com',
            bcc: ['bcc1@example.com', 'bcc2@example.com'],
            replyTo: 'reply@example.com',
            headers: { 'List-Id': 'yes' },
            attachments: [
                { filename: 'a.txt', content: 'hello', contentType: 'text/plain' },
                { filename: 'b.bin', content: new TextEncoder().encode('bin') },
            ],
        });

        expect(result).toEqual({ messageId: '<msg-1>', success: true });

        const [url, init] = fetchSpy!.mock.calls[0] as [string, any];
        expect(url).toBe('https://api.mailgun.net/v3/test.mailgun.org/messages');
        expect(init.method).toBe('POST');
        expect(init.headers.Authorization).toBe('Basic ' + btoa('api:key-12345'));

        const form = init.body as FormData;
        expect(form.get('to')).toBe('a@example.com,b@example.com');
        expect(form.get('from')).toBe('Test Sender <noreply@test.com>');
        expect(form.get('subject')).toBe('Hello');
        expect(form.get('text')).toBe('Body text');
        expect(form.get('html')).toBe('<p>Body</p>');
        expect(form.get('cc')).toBe('cc@example.com');
        expect(form.get('bcc')).toBe('bcc1@example.com,bcc2@example.com');
        expect(form.get('h:Reply-To')).toBe('reply@example.com');
        expect(form.get('h:List-Id')).toBe('yes');
        expect(form.getAll('attachment')).toHaveLength(2);
        expect((form.get('attachment') as File).name).toBe('a.txt');
    });

    it("falls back to a bare email when 'from' has no name", async () => {
        mockFetch(new Response(JSON.stringify({ id: '<x>', message: 'ok' }), { status: 200 }));

        const adapter = new MailgunEmailAdapter({
            provider: 'mailgun',
            apiKey: 'k',
            domain: 'd.org',
            from: { email: 'plain@test.com' },
        });
        await adapter.send({ to: 'x@example.com', subject: 's', text: 't' });

        const [, init] = fetchSpy!.mock.calls[0] as [string, any];
        expect((init.body as FormData).get('from')).toBe('plain@test.com');
    });

    it('throws on a non-ok Mailgun response', async () => {
        mockFetch(new Response('Forbidden', { status: 401 }));
        await expect(makeAdapter().send({ to: 'x@example.com', subject: 's', text: 't' })).rejects.toThrow(
            'Mailgun API error (401): Forbidden',
        );
    });

    it('sendTemplate throws instead of silently posting a placeholder', async () => {
        mockFetch(new Response(JSON.stringify({ id: '<tpl-1>', message: 'Queued' }), { status: 200 }));

        await expect(makeAdapter().sendTemplate('welcome', 'user@example.com', { name: 'Ada' })).rejects.toThrow(
            'sendTemplate not supported by mailgun',
        );
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('honors a custom baseUrl', async () => {
        mockFetch(new Response(JSON.stringify({ id: '<x>', message: 'ok' }), { status: 200 }));

        const adapter = new MailgunEmailAdapter({
            provider: 'mailgun',
            apiKey: 'k',
            domain: 'd.org',
            baseUrl: 'https://api.eu.mailgun.net/v3',
        });
        await adapter.send({ to: 'x@example.com', subject: 's', text: 't' });

        const [url] = fetchSpy!.mock.calls[0] as [string, any];
        expect(url).toBe('https://api.eu.mailgun.net/v3/d.org/messages');
    });
});
