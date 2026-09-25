import { describe, it, expect, afterEach, spyOn } from 'bun:test';
import { RecaptchaService } from '../src/domain/recaptcha/recaptcha.service';
import { config } from '../src/app.config.ts';

describe('RecaptchaService.verify', () => {
    let fetchSpy: ReturnType<typeof spyOn> | null = null;
    let warnSpy: ReturnType<typeof spyOn> | null = null;
    let errorSpy: ReturnType<typeof spyOn> | null = null;

    afterEach(() => {
        fetchSpy?.mockRestore();
        warnSpy?.mockRestore();
        errorSpy?.mockRestore();
        fetchSpy = warnSpy = errorSpy = null;
        config.recaptcha.hostnames = [];
    });

    function mockFetch(payload: unknown) {
        fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(payload))) as any;
    }

    // What siteverify returns for a token form-runtime.ts requested.
    const verified = { success: true, action: 'submit', hostname: 'forms.example.com' };

    it('accepts a token whose score meets the minimum', async () => {
        mockFetch({ ...verified, score: 0.9 });
        expect(await RecaptchaService.verify('tok')).toEqual({ valid: true, score: 0.9 });
    });

    it('rejects a token whose score is below the minimum', async () => {
        mockFetch({ ...verified, score: 0.3 });
        expect(await RecaptchaService.verify('tok')).toEqual({ valid: false, score: 0.3 });
    });

    it('treats a missing score as 0', async () => {
        mockFetch(verified);
        expect(await RecaptchaService.verify('tok')).toEqual({ valid: false, score: 0 });
    });

    it('rejects a token issued for another action', async () => {
        // Only success and score were checked: a token the site key issued
        // for any action, e.g. "login", was accepted as a form submission.
        warnSpy = spyOn(console, 'warn').mockImplementation(() => {}) as any;
        mockFetch({ ...verified, action: 'login', score: 0.9 });
        expect(await RecaptchaService.verify('tok')).toEqual({ valid: false, score: 0 });
        mockFetch({ success: true, hostname: 'forms.example.com', score: 0.9 });
        expect(await RecaptchaService.verify('tok')).toEqual({ valid: false, score: 0 });
    });

    it('rejects a token from a hostname outside RECAPTCHA_HOSTNAMES, when it is set', async () => {
        warnSpy = spyOn(console, 'warn').mockImplementation(() => {}) as any;
        config.recaptcha.hostnames = ['forms.example.com', 'www.example.com'];
        mockFetch({ ...verified, hostname: 'evil.example', score: 0.9 });
        expect(await RecaptchaService.verify('tok')).toEqual({ valid: false, score: 0 });
        mockFetch({ ...verified, hostname: undefined, score: 0.9 });
        expect(await RecaptchaService.verify('tok')).toEqual({ valid: false, score: 0 });

        mockFetch({ ...verified, hostname: 'www.example.com', score: 0.9 });
        expect(await RecaptchaService.verify('tok')).toEqual({ valid: true, score: 0.9 });
    });

    it('accepts any hostname when RECAPTCHA_HOSTNAMES is not set', async () => {
        mockFetch({ ...verified, hostname: 'localhost', score: 0.9 });
        expect(await RecaptchaService.verify('tok')).toEqual({ valid: true, score: 0.9 });
    });

    it('rejects an answer that is not JSON', async () => {
        errorSpy = spyOn(console, 'error').mockImplementation(() => {}) as any;
        fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>', { status: 502 })) as any;
        expect(await RecaptchaService.verify('tok')).toEqual({ valid: false, score: 0 });
    });

    it('rejects when Google reports failure', async () => {
        warnSpy = spyOn(console, 'warn').mockImplementation(() => {}) as any;
        mockFetch({ success: false, 'error-codes': ['timeout-or-duplicate'] });
        expect(await RecaptchaService.verify('tok')).toEqual({ valid: false, score: 0 });
        expect(warnSpy).toHaveBeenCalled();
    });

    it('rejects and swallows network errors', async () => {
        errorSpy = spyOn(console, 'error').mockImplementation(() => {}) as any;
        fetchSpy = spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down')) as any;
        expect(await RecaptchaService.verify('tok')).toEqual({ valid: false, score: 0 });
        expect(errorSpy).toHaveBeenCalled();
    });

    it("posts the secret and token to Google's siteverify endpoint", async () => {
        mockFetch({ ...verified, score: 0.8 });
        await RecaptchaService.verify('my-token');

        const [url, init] = fetchSpy!.mock.calls[0] as [string, any];
        expect(url).toBe('https://www.google.com/recaptcha/api/siteverify');
        expect(init.method).toBe('POST');
        const body = init.body as URLSearchParams;
        expect(body.get('response')).toBe('my-token');
        expect(body.get('secret')).toBeTruthy();
    });
});
