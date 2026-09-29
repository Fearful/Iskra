import { describe, expect, it } from 'bun:test';
import { App } from '@iskra-bun/core';
import { Kernel, Router, WebPlugin } from '../src/index';
import type { Context, MiddlewareHandler } from '../src/hono';

// The criteria of core's EchoRouter (a port of Echo's groups), as tests.

/** Middleware that appends its name to the X-Trace header, in the order it ran. */
const trace =
    (name: string): MiddlewareHandler =>
    async (c, next) => {
        c.set('trace' as never, [...((c.get('trace' as never) as string[] | undefined) ?? []), name] as never);
        await next();
    };
const traced = (c: Context) => c.json((c.get('trace' as never) as string[] | undefined) ?? []);

/** 401 without `Authorization: ok`. */
const auth: MiddlewareHandler = async (c, next) => {
    if (c.req.header('Authorization') !== 'ok') return c.json({ message: 'Unauthorized' }, 401);
    await next();
};

async function serve(router: Router) {
    const kernel = new Kernel({ logger: false });
    await kernel.initialize();
    return router.compile(kernel.getApp());
}

describe('Router groups', () => {
    it("runs the group's middleware, then the route's, and a subgroup inherits its parent's", async () => {
        const router = new Router();
        const api = router.group('/api', trace('api'));
        const users = api.group('/users', trace('users'));
        users.get('/:id', trace('route'), traced);
        const app = await serve(router);

        expect(await (await app.request('/api/users/1')).json()).toEqual(['api', 'users', 'route']);
    });

    it('use() reaches only the routes added after it', async () => {
        const router = new Router();
        const api = router.group('/api');
        api.get('/before', traced);
        api.use(trace('late'));
        api.get('/after', traced);
        const child = api.group('/child');
        child.get('/', traced);
        const app = await serve(router);

        expect(await (await app.request('/api/before')).json()).toEqual([]);
        expect(await (await app.request('/api/after')).json()).toEqual(['late']);
        expect(await (await app.request('/api/child/')).json()).toEqual(['late']);
    });

    it('does not run a group middleware for routes outside the group', async () => {
        const router = new Router();
        router.group('/private', auth).get('/data', (c) => c.text('secret'));
        router.get('/public', (c) => c.text('open'));
        const app = await serve(router);

        expect((await app.request('/public')).status).toBe(200);
        expect((await app.request('/private/data')).status).toBe(401);
    });
});

describe('Router priorities', () => {
    it('takes a static segment before a parameter, whatever the order they were added', async () => {
        const router = new Router();
        router.get('/users/:id', (c) => c.text(`user ${c.req.param('id')}`));
        router.get('/users/me', (c) => c.text('me'));
        router.get('/files/*', (c) => c.text('file'));
        router.get('/files/:name/meta', (c) => c.text('meta'));
        const app = await serve(router);

        expect(await (await app.request('/users/me')).text()).toBe('me');
        expect(await (await app.request('/users/7')).text()).toBe('user 7');
        expect(await (await app.request('/files/a/meta')).text()).toBe('meta');
        expect(await (await app.request('/files/a/b/c')).text()).toBe('file');
    });

    it('takes a named method before a route for every method', async () => {
        const router = new Router();
        router.all('/thing', (c) => c.text('any'));
        router.get('/thing', (c) => c.text('get'));
        const app = await serve(router);

        expect(await (await app.request('/thing')).text()).toBe('get');
        expect(await (await app.request('/thing', { method: 'POST' })).text()).toBe('any');
    });

    it('refuses the same method and path shape twice', () => {
        const router = new Router();
        router.get('/users/:id', (c) => c.text('a'));
        router.get('/users/:userId', (c) => c.text('b'));
        expect(() => router.compile()).toThrow('Route added twice: GET /users/:userId');
    });

    it('reads \\: as a literal colon', async () => {
        const router = new Router();
        router.get('/v1/items\\:batch', (c) => c.text('batch'));
        const app = await serve(router);
        expect(await (await app.request('/v1/items:batch')).text()).toBe('batch');
    });
});

describe('Router unmatched', () => {
    function guarded(then?: 404 | 'auto') {
        const router = new Router();
        const api = router.group('/api', auth);
        api.get('/users', (c) => c.json([]));
        api.post('/users', (c) => c.json({}, 201));
        api.get('/users/:id', (c) => c.json({ id: c.req.param('id') }));
        api.unmatched(then ? { then } : {});
        return serve(router);
    }
    const as = (method = 'GET', authorized = false): RequestInit => ({
        method,
        headers: authorized ? { Authorization: 'ok' } : {},
    });

    it('runs the auth before the 404: a guest cannot tell which paths exist', async () => {
        const app = await guarded();
        expect((await app.request('/api/nowhere', as())).status).toBe(401);
        expect((await app.request('/api', as())).status).toBe(401);
        expect((await app.request('/api/users', as('DELETE'))).status).toBe(401);
        expect((await app.request('/api/users', as('PURGE'))).status).toBe(401);

        const missing = await app.request('/api/nowhere', as('GET', true));
        expect(missing.status).toBe(404);
        expect(await missing.json()).toEqual({ error: 'Not Found', status: 404, code: 'NOT_FOUND' });
        // By default a method without a route is a 404 too, as in Echo under a group.
        expect((await app.request('/api/users', as('DELETE', true))).status).toBe(404);
    });

    it("answers 405 with Allow for a known path, with then: 'auto'", async () => {
        const app = await guarded('auto');
        const res = await app.request('/api/users', as('DELETE', true));
        expect(res.status).toBe(405);
        expect(res.headers.get('Allow')).toBe('GET, HEAD, POST');
        expect(await res.json()).toEqual({ error: 'Method Not Allowed', status: 405, code: 'METHOD_NOT_ALLOWED' });

        expect((await app.request('/api/users/1', as('PUT', true))).headers.get('Allow')).toBe('GET, HEAD');
        expect((await app.request('/api/nowhere', as('GET', true))).status).toBe(404);
    });

    it('leaves paths outside the prefix to the Kernel', async () => {
        const app = await guarded();
        const res = await app.request('/elsewhere', as());
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: 'Not Found', status: 404, code: 'NOT_FOUND' });
    });

    it('takes the middleware to run from use, and the last call for a prefix wins', async () => {
        const router = new Router();
        const api = router.group('/api', trace('heavy'));
        api.get('/x', traced);
        api.unmatched({ use: [trace('first')] });
        api.unmatched({ use: [auth] });
        const app = await serve(router);
        expect((await app.request('/api/y')).status).toBe(401);
        expect((await app.request('/api/y', { headers: { Authorization: 'ok' } })).status).toBe(404);
    });

    it('answers a more specific prefix by its own rule', async () => {
        const router = new Router();
        const api = router.group('/api');
        api.get('/open', (c) => c.text('open'));
        api.unmatched();
        const admin = api.group('/admin', auth);
        admin.get('/stats', (c) => c.text('stats'));
        admin.unmatched();
        const app = await serve(router);

        expect((await app.request('/api/nowhere')).status).toBe(404);
        expect((await app.request('/api/admin/nowhere')).status).toBe(401);
    });

    it('answers HEAD without a body', async () => {
        const app = await guarded();
        const res = await app.request('/api/nowhere', as('HEAD', true));
        expect(res.status).toBe(404);
        expect(await res.text()).toBe('');
    });
});

describe('WebPlugin with a Router', () => {
    it('compiles it after the features, so their middleware covers the routes', async () => {
        const router = new Router();
        router.group('/api').get('/ping', (c) => c.text('pong'));
        const web = new WebPlugin({ router, logger: false });
        await web.init(new App({ name: 'RouterTest', logger: { level: 'silent' } }));

        const res = await web.getHonoApp().request('/api/ping');
        expect(await res.text()).toBe('pong');
        expect(res.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
    });
});
