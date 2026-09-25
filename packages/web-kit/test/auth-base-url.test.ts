import { afterEach, describe, expect, it } from 'bun:test';
import { AuthFeature } from '../src/features/auth/index';

const secret = 'x'.repeat(40);
const fakeCreateAuth = (() => ({
    handler: async () => new Response('ok'),
    api: { getSession: async () => null },
})) as any;

// better-auth ignores basePath when baseURL has a path, so e.g. a proxy prefix
// in baseURL made every auth route 404 (forms-app's docker-compose did this).
describe('AuthFeature baseURL', () => {
    it('rejects a baseURL whose path differs from basePath', () => {
        expect(
            () =>
                new AuthFeature(
                    { secret, baseURL: 'http://localhost/admin/api', basePath: '/api/auth' },
                    fakeCreateAuth,
                ),
        ).toThrow(/baseURL "http:\/\/localhost\/admin\/api" has the path "\/admin\/api".*"http:\/\/localhost"/);
    });

    it('accepts an origin, or a path equal to basePath', () => {
        expect(
            () => new AuthFeature({ secret, baseURL: 'http://localhost:4000', basePath: '/api/auth' }, fakeCreateAuth),
        ).not.toThrow();
        expect(() => new AuthFeature({ secret, baseURL: 'https://example.com/' }, fakeCreateAuth)).not.toThrow();
        expect(() => new AuthFeature({ secret, baseURL: 'https://example.com/api/sso' }, fakeCreateAuth)).not.toThrow();
    });

    it('rejects an invalid baseURL', () => {
        expect(() => new AuthFeature({ secret, baseURL: 'not a url' }, fakeCreateAuth)).toThrow(/invalid baseURL/);
    });
});

describe('AuthFeature baseURL in production', () => {
    const saved = process.env.NODE_ENV;
    afterEach(() => {
        process.env.NODE_ENV = saved;
    });
    const build = (baseURL: string) => () => new AuthFeature({ secret, baseURL }, fakeCreateAuth);

    it('refuses plain http, which gave session cookies without Secure', () => {
        // Regression: better-auth marks cookies Secure only for an https
        // baseURL, and production accepted an http:// one.
        process.env.NODE_ENV = 'production';
        expect(build('http://app.example.com')).toThrow(/"http:\/\/app\.example\.com" must use https in production/);
        expect(build('http://10.0.0.5:4000')).toThrow(/must use https/);
    });

    it('accepts https, and http on localhost', () => {
        process.env.NODE_ENV = 'production';
        for (const baseURL of [
            'https://app.example.com',
            'http://localhost',
            'http://localhost:4000',
            'http://127.0.0.1:3000',
            'http://[::1]:3000',
        ]) {
            expect(build(baseURL)).not.toThrow();
        }
    });

    it('accepts plain http outside production', () => {
        process.env.NODE_ENV = 'development';
        expect(build('http://app.example.com')).not.toThrow();
    });
});
