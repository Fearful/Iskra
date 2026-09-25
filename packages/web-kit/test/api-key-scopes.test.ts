import { describe, it, expect } from 'bun:test';
import { Kernel } from '../src/kernel';
import { ApiKeyStore, ApiKeyFeature, requireApiKey, requireScope } from '../src/features/api-key';

describe('ApiKeyStore.hasScopes', () => {
    const store = new ApiKeyStore({ staticKeys: [] } as any, {} as any);

    it('allows when no scopes are required', () => {
        expect(store.hasScopes({ scopes: ['read'] } as any, [])).toBe(true);
    });

    it('denies when the key has no scopes but some are required', () => {
        expect(store.hasScopes({ scopes: [] } as any, ['read'])).toBe(false);
    });

    it('matches exact scopes', () => {
        expect(store.hasScopes({ scopes: ['read', 'write'] } as any, ['read'])).toBe(true);
        expect(store.hasScopes({ scopes: ['read'] } as any, ['write'])).toBe(false);
    });

    it('supports wildcard scopes', () => {
        expect(store.hasScopes({ scopes: ['users:*'] } as any, ['users:read'])).toBe(true);
        expect(store.hasScopes({ scopes: ['users:*'] } as any, ['posts:read'])).toBe(false);
    });

    it('requires every scope when several are requested', () => {
        expect(store.hasScopes({ scopes: ['read'] } as any, ['read', 'write'])).toBe(false);
        expect(store.hasScopes({ scopes: ['read', 'write'] } as any, ['read', 'write'])).toBe(true);
    });
});

describe('ApiKeyFeature skipPaths', () => {
    it('bypasses validation for configured exact and wildcard paths', async () => {
        const kernel = new Kernel();
        kernel.registerFeature(
            new ApiKeyFeature({
                staticKeys: [{ key: 'good-key', name: 'k', scopes: ['read'] }],
                skipPaths: ['/health', '/assets/*'],
            }),
        );
        await kernel.initialize();

        const app = kernel.getApp();
        app.get('/health', (c) => c.text('ok'));
        app.get('/assets/logo.png', (c) => c.text('img'));
        app.get('/api', requireApiKey(), (c) => c.text('secret'));

        // A bad key is ignored on skipped paths…
        expect((await app.request('/health', { headers: { 'X-API-Key': 'bad' } })).status).toBe(200);
        expect((await app.request('/assets/logo.png', { headers: { 'X-API-Key': 'bad' } })).status).toBe(200);
        // …but rejected on a protected path.
        expect((await app.request('/api', { headers: { 'X-API-Key': 'bad' } })).status).toBe(401);

        await kernel.shutdown();
    });
});

describe('requireApiKey / requireScope guards', () => {
    async function setup() {
        const kernel = new Kernel();
        kernel.registerFeature(
            new ApiKeyFeature({
                staticKeys: [{ key: 'scoped-key', name: 'k', scopes: ['users:read'] }],
            }),
        );
        await kernel.initialize();
        const app = kernel.getApp();
        app.get('/need-key', requireApiKey(), (c) => c.text('ok'));
        app.get('/need-scope', requireScope('users:read'), (c) => c.text('ok'));
        app.get('/need-admin', requireScope('admin'), (c) => c.text('ok'));
        return { kernel, app };
    }

    const withKey = { headers: { 'X-API-Key': 'scoped-key' } };

    it('requireApiKey rejects without a key and passes with one', async () => {
        const { kernel, app } = await setup();
        expect((await app.request('/need-key')).status).toBe(401);
        expect((await app.request('/need-key', withKey)).status).toBe(200);
        await kernel.shutdown();
    });

    it('requireScope enforces the scope', async () => {
        const { kernel, app } = await setup();
        expect((await app.request('/need-scope', withKey)).status).toBe(200);
        expect((await app.request('/need-admin', withKey)).status).toBe(403);
        expect((await app.request('/need-scope')).status).toBe(401);
        await kernel.shutdown();
    });
});
