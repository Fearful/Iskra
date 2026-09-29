import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { createTestKernel } from '@iskra-bun/web-kit/testing';
import { ErrorHandlerFeature, NotFoundError, RequestIdFeature, Router, requireActor, bearer } from '../src/index';

describe('createTestKernel()', () => {
    it('builds the app as WebPlugin does: features first, then the router', async () => {
        const router = new Router();
        const api = router.group('/api', requireActor(bearer((t) => (t === 'ok' ? { kind: 'user', id: '1' } : null))));
        api.get('/me', (c) => c.json(c.var.actor));
        api.get('/missing', () => {
            throw new NotFoundError('No such thing');
        });
        api.unmatched();

        const { request, close } = await createTestKernel({
            router,
            features: [new RequestIdFeature(), new ErrorHandlerFeature()],
        });
        const me = await request('/api/me', { headers: { Authorization: 'Bearer ok' } });
        expect(await me.json()).toEqual({ kind: 'user', id: '1' });
        expect(me.headers.get('X-Request-ID')).not.toBeNull();
        expect(me.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
        expect((await request('/api/nowhere')).status).toBe(401);
        expect((await request('/api/missing', { headers: { Authorization: 'Bearer ok' } })).status).toBe(404);
        await close();
    });

    it('mounts a plain Hono app at "/"', async () => {
        const hono = new Hono();
        hono.get('/ping', (c) => c.text('pong'));
        const { request, close } = await createTestKernel({ router: hono });
        expect(await (await request('/ping')).text()).toBe('pong');
        await close();
    });
});
