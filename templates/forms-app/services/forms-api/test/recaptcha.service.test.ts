import { describe, it, expect, afterEach, spyOn } from 'bun:test';
import { RecaptchaService } from '../src/domain/recaptcha/recaptcha.service';

describe('RecaptchaService.verify', () => {
    let fetchSpy: ReturnType<typeof spyOn> | null = null;
    let warnSpy: ReturnType<typeof spyOn> | null = null;
    let errorSpy: ReturnType<typeof spyOn> | null = null;

    afterEach(() => {
        fetchSpy?.mockRestore();
        warnSpy?.mockRestore();
        errorSpy?.mockRestore();
        fetchSpy = warnSpy = errorSpy = null;
    });

    function mockFetch(payload: unknown) {
        fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(payload))) as any;
    }

    it('accepts a token whose score meets the minimum', async () => {
        mockFetch({ success: true, score: 0.9 });
        expect(await RecaptchaService.verify('tok')).toEqual({ valid: true, score: 0.9 });
    });

    it('rejects a token whose score is below the minimum', async () => {
        mockFetch({ success: true, score: 0.3 });
        expect(await RecaptchaService.verify('tok')).toEqual({ valid: false, score: 0.3 });
    });

    it('treats a missing score as 0', async () => {
        mockFetch({ success: true });
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
        mockFetch({ success: true, score: 0.8 });
        await RecaptchaService.verify('my-token');

        const [url, init] = fetchSpy!.mock.calls[0] as [string, any];
        expect(url).toBe('https://www.google.com/recaptcha/api/siteverify');
        expect(init.method).toBe('POST');
        const body = init.body as URLSearchParams;
        expect(body.get('response')).toBe('my-token');
        expect(body.get('secret')).toBeTruthy();
    });
});
