import { afterEach, describe, expect, it } from 'bun:test';
import { hasInternalApiToken, internalApiHeaders, internalApiToken } from '../src/internal-api.ts';

const TOKEN = 'k'.repeat(44);
const nodeEnv = process.env.NODE_ENV;
const envToken = process.env.INTERNAL_API_TOKEN;

afterEach(() => {
    process.env.NODE_ENV = nodeEnv;
    if (envToken === undefined) delete process.env.INTERNAL_API_TOKEN;
    else process.env.INTERNAL_API_TOKEN = envToken;
});

describe('hasInternalApiToken', () => {
    it('accepts the token sent by internalApiHeaders', () => {
        expect(hasInternalApiToken(internalApiHeaders(TOKEN).Authorization, TOKEN)).toBe(true);
    });

    it('refuses a missing, wrong or unprefixed token', () => {
        expect(hasInternalApiToken(undefined, TOKEN)).toBe(false);
        expect(hasInternalApiToken('', TOKEN)).toBe(false);
        expect(hasInternalApiToken('Bearer ', TOKEN)).toBe(false);
        expect(hasInternalApiToken(`Bearer ${TOKEN}x`, TOKEN)).toBe(false);
        expect(hasInternalApiToken(`Bearer ${TOKEN.slice(1)}`, TOKEN)).toBe(false);
        expect(hasInternalApiToken(TOKEN, TOKEN)).toBe(false);
        expect(hasInternalApiToken('Bearer ', '')).toBe(false);
    });
});

describe('internalApiToken', () => {
    it('is required in production', () => {
        process.env.NODE_ENV = 'production';
        delete process.env.INTERNAL_API_TOKEN;
        expect(() => internalApiToken()).toThrow('INTERNAL_API_TOKEN must be set in production');
        process.env.INTERNAL_API_TOKEN = 'short';
        expect(() => internalApiToken()).toThrow('at least 32 characters');
        process.env.INTERNAL_API_TOKEN = TOKEN;
        expect(internalApiToken()).toBe(TOKEN);
    });
});
