import { RECAPTCHA_ACTION } from '@forms-app/shared';
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

            // Only `success` and the score used to be checked, so a token the
            // site key issued for another action, or on another site that uses
            // the key, was accepted too.
            if (data.action !== RECAPTCHA_ACTION) {
                console.warn('reCAPTCHA token for another action:', data.action);
                return { valid: false, score: 0 };
            }
            const { hostnames } = config.recaptcha;
            if (hostnames.length > 0 && !hostnames.includes(String(data.hostname).toLowerCase())) {
                console.warn('reCAPTCHA token from another hostname:', data.hostname);
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
