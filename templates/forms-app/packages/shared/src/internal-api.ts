import { createHash, timingSafeEqual } from 'node:crypto';
import { secretFromEnv } from './env.ts';

/**
 * The token of form-manager's /internal API (pre-render, open, close, remove),
 * which used to answer anyone who could reach the service: admin-api and cron
 * send it, form-manager requires it. Outside production the three share a
 * development value, so `bun dev` needs no .env.
 */
export function internalApiToken(): string {
    return secretFromEnv('INTERNAL_API_TOKEN', 'dev-internal-api-token-not-for-production');
}

/** Headers of a request to form-manager's /internal API. */
export function internalApiHeaders(token: string): Record<string, string> {
    return { Authorization: `Bearer ${token}` };
}

/**
 * Whether an Authorization header carries `token`. The SHA-256 digests are
 * compared in constant time, so neither the token nor its length leaks
 * through the response time.
 */
export function hasInternalApiToken(authorization: string | undefined, token: string): boolean {
    const presented = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : '';
    if (!presented || !token) return false;
    const digest = (value: string) => createHash('sha256').update(value).digest();
    return timingSafeEqual(digest(presented), digest(token));
}
