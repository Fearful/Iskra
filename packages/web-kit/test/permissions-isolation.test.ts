import { describe, it, expect } from 'bun:test';
import { Kernel } from '../src/kernel';
import { CacheFeature } from '../src/features/cache';
import { PermissionsFeature, requirePermission } from '../src/features/permissions';

/** Minimal stand-in for AuthFeature: the user id comes from a header. */
class HeaderAuthFeature {
    name = 'auth';
    async initialize(kernel: Kernel) {
        kernel.getApp().use('*', async (c, next) => {
            const id = c.req.header('x-user');
            if (id) c.set('user', { id } as any);
            await next();
        });
    }
}

describe('PermissionsFeature isolation between users', () => {
    it('does not leak role permissions through an array shared by the loader', async () => {
        // Regression: role permissions were pushed into the array returned by
        // loadPermissions(); a loader returning a shared/cached array handed the
        // admin's "*" to every later user.
        const shared = ['read:own'];
        const kernel = new Kernel();
        kernel.registerFeature(new HeaderAuthFeature() as any);
        kernel.registerFeature(
            new PermissionsFeature({
                loadPermissions: async () => shared,
                loadRoles: async (id) => (id === 'root' ? ['admin'] : ['user']),
                cachePermissions: false,
            }),
        );
        await kernel.initialize();
        const app = kernel.getApp();
        app.get('/danger', requirePermission('delete:everything'), (c) => c.text('ok'));

        expect((await app.request('/danger', { headers: { 'x-user': 'root' } })).status).toBe(200);
        expect((await app.request('/danger', { headers: { 'x-user': 'alice' } })).status).toBe(403);
        expect(shared).toEqual(['read:own']);
    });
});

describe('PermissionsFeature cache', () => {
    async function setup(roles: Map<string, string[]>) {
        const kernel = new Kernel({ logger: false });
        const cache = new CacheFeature({ adapter: 'memory' });
        kernel.registerFeature(cache);
        kernel.registerFeature(new HeaderAuthFeature() as any);
        const permissions = new PermissionsFeature({
            loadPermissions: async () => [],
            loadRoles: async (id) => roles.get(id) ?? [],
        });
        kernel.registerFeature(permissions);
        await kernel.initialize();
        const app = kernel.getApp();
        app.get('/danger', requirePermission('delete:everything'), (c) => c.text('ok'));
        return { kernel, app, cache, permissions };
    }

    it('invalidate(userId) makes a revoked role stop working at once', async () => {
        // Regression: roles were cached for an hour with no way to drop them,
        // so an admin whose role was revoked stayed an admin that long.
        const roles = new Map([['alice', ['admin']]]);
        const { kernel, app, permissions } = await setup(roles);
        const asAlice = () => app.request('/danger', { headers: { 'x-user': 'alice' } });
        expect((await asAlice()).status).toBe(200);

        roles.set('alice', ['user']);
        expect((await asAlice()).status).toBe(200); // the cached roles still apply
        await permissions.invalidate('alice');
        expect((await asAlice()).status).toBe(403);
        await kernel.shutdown();
    });

    it('keeps them 60 seconds by default, not an hour', async () => {
        const { kernel, app, cache } = await setup(new Map([['bob', ['user']]]));
        const ttls: (number | undefined)[] = [];
        const set = cache.client.set.bind(cache.client);
        cache.client.set = async (key, value, ttl) => {
            ttls.push(ttl);
            await set(key, value, ttl);
        };
        await app.request('/danger', { headers: { 'x-user': 'bob' } });
        expect(ttls).toEqual([60]);
        await kernel.shutdown();
    });
});

/** Minimal stand-in for SessionFeature: the session holds the user of a header. */
class HeaderSessionFeature {
    name = 'session';
    async initialize(kernel: Kernel) {
        kernel.getApp().use('*', async (c, next) => {
            const id = c.req.header('x-session-user');
            if (id) c.set('session', { user: { id } } as any);
            await next();
        });
    }
}

describe('PermissionsFeature ordering', () => {
    it('reads a session registered after it', async () => {
        // Regression: it only depended on "auth", so a session feature
        // registered later ran after it and the session's user was never seen.
        const kernel = new Kernel({ logger: false });
        kernel.registerFeature(new HeaderAuthFeature() as any);
        kernel.registerFeature(
            new PermissionsFeature({
                loadRoles: async (id) => (id === 'root' ? ['admin'] : ['user']),
                cachePermissions: false,
            }),
        );
        kernel.registerFeature(new HeaderSessionFeature() as any);
        await kernel.initialize();
        const app = kernel.getApp();
        app.get('/danger', requirePermission('delete:everything'), (c) => c.text('ok'));

        expect((await app.request('/danger', { headers: { 'x-session-user': 'root' } })).status).toBe(200);
        expect((await app.request('/danger')).status).toBe(403);
    });

    it('uses a cache registered after it', async () => {
        let loads = 0;
        const kernel = new Kernel({ logger: false });
        kernel.registerFeature(new HeaderAuthFeature() as any);
        kernel.registerFeature(
            new PermissionsFeature({
                loadRoles: async () => {
                    loads++;
                    return ['admin'];
                },
            }),
        );
        kernel.registerFeature(new CacheFeature({ adapter: 'memory' }));
        await kernel.initialize();
        const app = kernel.getApp();
        app.get('/danger', requirePermission('delete:everything'), (c) => c.text('ok'));

        expect((await app.request('/danger', { headers: { 'x-user': 'root' } })).status).toBe(200);
        expect((await app.request('/danger', { headers: { 'x-user': 'root' } })).status).toBe(200);
        expect(loads).toBe(1);
        await kernel.shutdown();
    });

    it('starts without an auth feature and denies by default', async () => {
        const kernel = new Kernel({ logger: false });
        kernel.registerFeature(new PermissionsFeature({ anonymousPermissions: ['read:public'] }));
        await kernel.initialize();
        const app = kernel.getApp();
        app.get('/public', requirePermission('read:public'), (c) => c.text('ok'));
        app.get('/danger', requirePermission('delete:everything'), (c) => c.text('ok'));

        expect((await app.request('/public')).status).toBe(200);
        expect((await app.request('/danger')).status).toBe(403);
    });
});
