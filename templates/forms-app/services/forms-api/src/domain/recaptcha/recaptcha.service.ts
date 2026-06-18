import { config } from '../../app.config.ts';

interface RecaptchaResponse {
    success: boolean;
    score?: number;
    action?: string;
    challenge_ts?: string;
    hostname?: string;
    'error-codes'?: string[];
}

export class RecaptchaService {
    static async verify(token: string): Promise<{ valid: boolean; score: number }> {
        try {
            const res = await fetch('https://www.google.com/recaptcha/api/siteverify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    secret: config.recaptcha.secret,
                    response: token,
                }),
            });

            const data: RecaptchaResponse = await res.json();

            if (!data.success) {
                console.warn('reCAPTCHA verification failed:', data['error-codes']);
                return { valid: false, score: 0 };
            }

            const score = data.score ?? 0;
            return {
                valid: score >= config.recaptcha.minScore,
                score,
            };
        } catch (err) {
            console.error('reCAPTCHA verification error:', err);
            return { valid: false, score: 0 };
        }
    }
}
