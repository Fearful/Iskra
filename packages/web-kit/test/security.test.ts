import { describe, expect, it } from 'bun:test';
import { Kernel } from '../src/kernel';
import { ApiKeyFeature, requireApiKey } from '../src/features/api-key';
import { CsrfFeature } from '../src/features/csrf';
import { RateLimitFeature } from '../src/features/rate-limit';
import { PermissionsFeature, requirePermission } from '../src/features/permissions';
import { AuthFeature } from '../src/features/auth';
import { SessionFeature } from '../src/features/session';
import { DbFeature } from '../src/features/db';

describe('Security Features', () => {
    it('should validate static API key', async () => {
        const kernel = new Kernel();
        const apiKey = new ApiKeyFeature({
            staticKeys: [{ key: 'secret-key', name: 'test-client' }],
        });
        kernel.registerFeature(apiKey);
        await kernel.initialize();

        const app = kernel.getApp();
        app.get('/protected', requireApiKey(), (c) => c.json({ ok: true }));

        // No key
        const res1 = await app.request('/protected');
        expect(res1.status).toBe(401);

        // Invalid key
        const res2 = await app.request('/protected', { headers: { 'X-API-Key': 'wrong' } });
        expect(res2.status).toBe(401);

        // Valid key
        const res3 = await app.request('/protected', { headers: { 'X-API-Key': 'secret-key' } });
        expect(res3.status).toBe(200);
    });

    it('should handle CSRF', async () => {
        const kernel = new Kernel();
        kernel.registerFeature(new CsrfFeature({ secret: 'csrf-secret-0123456789abcdef0123456789' }));
        await kernel.initialize();

        const app = kernel.getApp();
        app.post('/state-change', (c) => c.json({ ok: true }));

        // No token
        const res1 = await app.request('/state-change', { method: 'POST' });
        expect(res1.status).toBe(403);
    });

    it('should rate limit requests', async () => {
        const kernel = new Kernel();
        kernel.registerFeature(
            new RateLimitFeature({
                windowMs: 1000,
                max: 2,
                keyGenerator: () => 'test-client',
            }),
        );
        await kernel.initialize();

        const app = kernel.getApp();
        app.get('/limit', (c) => c.text('ok'));

        expect((await app.request('/limit')).status).toBe(200);
        expect((await app.request('/limit')).status).toBe(200);
        expect((await app.request('/limit')).status).toBe(429);
    });

    it('should enforce permissions', async () => {
        const kernel = new Kernel();
        // Setup auth to mock a user
        // Since we don't have full login flow hooks here easily without mocking context or creating a detailed AuthFeature...
        // We can mock middleware or use AuthFeature which reads session
        // Let's use SessionFeature to set a mock session

        kernel.registerFeature(new DbFeature({ adapter: 'sqlite', connection: { database: ':memory:' } }));
        kernel.registerFeature(
            new SessionFeature({ store: 'memory', secret: 'test-0123456789abcdef0123456789abcdef' }),
        );
        // auth-kit rejects secrets shorter than 32 chars; supply a valid one.
        kernel.registerFeature(new AuthFeature({ secret: 'x'.repeat(32) }));
        kernel.registerFeature(
            new PermissionsFeature({
                loadPermissions: async () => ['read:own'], // Default permission
                enableRBAC: false,
            }),
        );

        await kernel.initialize();
        const app = kernel.getApp();

        // Mock session middleware for testing
        app.use('*', async (c, next) => {
            // Inject a user via context directly for test (AuthFeature reads session, but we can bypass)
            // Or set session cookie. simpler to inject context if we could.
            // But Hono context is created on request.
            // We'll rely on our mocked session logic in SessionFeature if accessible,
            // or just mocking the whole flow?
            // Actually, the SessionFeature simplified implementation reads a cookie "sid".
            // We'll trust that empty session = unlimited guest or no user.
            // PermissionsFeature handles no user as "anonymousPermissions" (read:public).
            await next();
        });

        app.get('/private', requirePermission('read:own'), (c) => c.text('ok'));
        app.get('/public', requirePermission('read:public'), (c) => c.text('ok'));

        // Anonymous user (no session) -> read:public
        const res1 = await app.request('/public');
        expect(res1.status).toBe(200);

        const res2 = await app.request('/private');
        expect(res2.status).toBe(403); // Anonymous doesn't have read:own
    });
});
