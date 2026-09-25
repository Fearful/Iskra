import { describe, expect, it, afterEach, spyOn } from 'bun:test';
import { MailgunEmailAdapter } from '../src/providers/mailgun';

/**
 * RED — Finding: MEDIUM Mailgun outbound header injection.
 *
 * `message.headers` are forwarded verbatim as `h:<key>` outbound mail headers
 * with no allowlist, letting callers spoof Reply-To / Sender / List-Unsubscribe
 * and inject CR/LF into header values.
 *
 * Desired fixed behavior:
 *   - Only an allowlist of header names may be forwarded.
 *   - A non-allowlisted header name is REJECTED (throws), not silently sent.
 *   - CR/LF characters in header values are stripped (no header injection).
 *   - A normal allowlisted header still goes through.
 *
 * These tests FAIL today because the loop appends every header unconditionally
 * and never throws or sanitizes.
 */
describe('Mailgun outbound header allowlist', () => {
    let fetchSpy: ReturnType<typeof spyOn> | null = null;

    afterEach(() => {
        fetchSpy?.mockRestore();
        fetchSpy = null;
    });

    function mockFetch() {
        fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ id: '<m>', message: 'Queued' }), { status: 200 }),
        ) as any;
    }

    const makeAdapter = () =>
        new MailgunEmailAdapter({
            provider: 'mailgun',
            apiKey: 'key-12345',
            domain: 'test.mailgun.org',
            from: { email: 'no-reply@iskra.dev', name: 'Iskra' },
        });

    it('rejects a non-allowlisted outbound header instead of forwarding it', async () => {
        mockFetch();

        await expect(
            makeAdapter().send({
                to: 'user@example.com',
                subject: 's',
                text: 't',
                headers: { 'X-Evil-Inject': 'boom' },
            }),
        ).rejects.toThrow(/header/i);

        // The send must be aborted before reaching the network.
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('strips CR/LF from an allowlisted header value (no header injection)', async () => {
        mockFetch();

        await makeAdapter().send({
            to: 'user@example.com',
            subject: 's',
            text: 't',
            headers: { 'List-Unsubscribe': '<https://x.com/u>\r\nBcc: attacker@evil.com' },
        });

        const [, init] = fetchSpy!.mock.calls[0] as [string, any];
        const value = (init.body as FormData).get('h:List-Unsubscribe') as string;
        expect(value).not.toContain('\r');
        expect(value).not.toContain('\n');
        expect(value).not.toContain('Bcc:');
    });

    it('still forwards a normal allowlisted header', async () => {
        mockFetch();

        await makeAdapter().send({
            to: 'user@example.com',
            subject: 's',
            text: 't',
            headers: { 'List-Unsubscribe': '<https://x.com/unsub>' },
        });

        const [, init] = fetchSpy!.mock.calls[0] as [string, any];
        const form = init.body as FormData;
        expect(form.get('h:List-Unsubscribe')).toBe('<https://x.com/unsub>');
    });
});
