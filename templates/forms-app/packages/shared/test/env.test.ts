import { afterEach, describe, expect, it } from 'bun:test';
import { secretFromEnv } from '../src/env.ts';

const NAME = 'FORMS_APP_TEST_SECRET';
const DEV = 'dev-default-secret-for-the-test-suite';
const nodeEnv = process.env.NODE_ENV;

afterEach(() => {
    process.env.NODE_ENV = nodeEnv;
    delete process.env[NAME];
});

describe('secretFromEnv', () => {
    it('falls back to the development value outside production', () => {
        expect(secretFromEnv(NAME, DEV)).toBe(DEV);
        process.env[NAME] = 'short';
        expect(secretFromEnv(NAME, DEV)).toBe('short');
    });

    it('refuses to start in production without the secret', () => {
        // The services used to run with a default written in the repository.
        process.env.NODE_ENV = 'production';
        expect(() => secretFromEnv(NAME, DEV)).toThrow(`${NAME} must be set in production`);
        process.env[NAME] = '';
        expect(() => secretFromEnv(NAME, DEV)).toThrow(`${NAME} must be set in production`);
    });

    it('refuses the development value, a placeholder, or a short one, in production', () => {
        process.env.NODE_ENV = 'production';
        process.env[NAME] = DEV;
        expect(() => secretFromEnv(NAME, DEV)).toThrow(`${NAME} must be set in production`);
        for (const placeholder of [
            'your-secret-key',
            'Change_Me.Please-0123456789abcdefghijk',
            'PLACEHOLDER'.repeat(4),
        ]) {
            process.env[NAME] = placeholder;
            expect(() => secretFromEnv(NAME, DEV, { minLength: 1 })).toThrow(`${NAME} must be set in production`);
        }
        process.env[NAME] = 'x'.repeat(31);
        expect(() => secretFromEnv(NAME, DEV)).toThrow('at least 32 characters');
        expect(secretFromEnv(NAME, DEV, { minLength: 8 })).toBe('x'.repeat(31));
    });

    it('returns the secret set in production', () => {
        process.env.NODE_ENV = 'production';
        process.env[NAME] = 'k'.repeat(44);
        expect(secretFromEnv(NAME, DEV)).toBe('k'.repeat(44));
    });
});
