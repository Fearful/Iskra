import { describe, expect, it } from 'bun:test';
import { ErrorCodes, IskraError, type ErrorCode } from '@iskra-bun/core';
import { z } from 'zod';
import {
    ErrorHandlerFeature,
    HttpError,
    Kernel,
    NotFoundError,
    RateLimitFeature,
    RequestIdFeature,
    fail,
    list,
    ok,
    problemDetailsContract,
    validate,
    type Problem,
    type ResponseContract,
} from '../src/index';
import { HTTPException } from '../src/hono';

declare module '@iskra-bun/core' {
    interface ErrorCodeRegistry {
        ORDER_LOCKED: true;
    }
}

async function kernel(config: ConstructorParameters<typeof Kernel>[0] = {}, ...features: unknown[]) {
    const k = new Kernel({ logger: false, ...config });
    for (const feature of features) k.registerFeature(feature as never);
    await k.initialize();
    return k;
}

describe("Iskra's contract (the default)", () => {
    it('answers an unknown route with a JSON 404', async () => {
        const app = (await kernel()).getApp();
        const res = await app.request('/nowhere');
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: 'Not Found', status: 404, code: 'NOT_FOUND' });
    });

    it('answers HEAD without a body or content type', async () => {
        const app = (await kernel()).getApp();
        const res = await app.request('/nowhere', { method: 'HEAD' });
        expect(res.status).toBe(404);
        expect(res.headers.get('content-type')).toBeNull();
        expect(await res.text()).toBe('');
    });

    it('keeps the status of an HttpError without ErrorHandlerFeature', async () => {
        const app = (await kernel()).getApp();
        app.get('/user', () => {
            throw new NotFoundError('User not found');
        });
        const res = await app.request('/user');
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: 'User not found', status: 404, code: 'NOT_FOUND' });
    });

    it("gives a HTTPException its status's code, and the request id", async () => {
        const app = (await kernel({}, new RequestIdFeature())).getApp();
        app.get('/denied', () => {
            throw new HTTPException(403, { message: 'Denied' });
        });
        const res = await app.request('/denied', { headers: { 'X-Request-ID': 'req-1' } });
        expect(await res.json()).toEqual({ error: 'Denied', status: 403, code: 'FORBIDDEN', requestId: 'req-1' });
    });

    it('answers a rate limit with RATE_LIMITED and keeps Retry-After', async () => {
        const app = (await kernel({}, new RateLimitFeature({ max: 1, windowMs: 60_000 }))).getApp();
        app.get('/x', (c) => c.text('ok'));
        await app.request('/x');
        const res = await app.request('/x');
        expect(res.status).toBe(429);
        expect(res.headers.get('Retry-After')).not.toBeNull();
        expect(await res.json()).toMatchObject({ status: 429, code: 'RATE_LIMITED' });
    });

    it("answers any IskraError with its code's status, and shows its message only if exposed", async () => {
        class Hidden extends IskraError {}
        class Shown extends IskraError {
            readonly expose = true;
        }
        const app = (await kernel()).getApp();
        app.get('/hidden', () => {
            throw new Hidden('row 12 of SECRET_TABLE', { code: ErrorCodes.CONFLICT });
        });
        app.get('/shown', () => {
            throw new Shown('Cannot sort by password', { code: ErrorCodes.VALIDATION_ERROR });
        });
        app.get('/internal', () => {
            throw new Hidden('ORA-12541: no listener at db-host:1521', { code: ErrorCodes.QUERY_ERROR });
        });

        expect(await (await app.request('/hidden')).json()).toEqual({
            error: 'Conflict',
            status: 409,
            code: 'CONFLICT',
        });
        expect(await (await app.request('/shown')).json()).toEqual({
            error: 'Cannot sort by password',
            status: 400,
            code: 'VALIDATION_ERROR',
        });
        expect(await (await app.request('/internal')).json()).toEqual({
            error: 'Internal Server Error',
            status: 500,
            code: 'QUERY_ERROR',
        });
    });

    it('hides a plain error, and shows it with includeStack', async () => {
        const hidden = (await kernel({ includeStack: false })).getApp();
        hidden.get('/boom', () => {
            throw new Error('password=hunter2');
        });
        expect(await (await hidden.request('/boom')).json()).toEqual({
            error: 'Internal Server Error',
            status: 500,
            code: 'INTERNAL_ERROR',
        });

        const shown = (await kernel({ includeStack: true })).getApp();
        shown.get('/boom', () => {
            throw new Error('password=hunter2');
        });
        const body = (await (await shown.request('/boom')).json()) as { error: string; stack?: string };
        expect(body.error).toBe('password=hunter2');
        expect(body.stack).toContain('Error: password=hunter2');
    });

    it("takes an app's own error code, with the status and headers it gives", async () => {
        const locked: ErrorCode = 'ORDER_LOCKED';
        const app = (await kernel()).getApp();
        app.post('/orders/1', () => {
            throw new HttpError(423, 'The order is being edited', { code: locked, headers: { 'Retry-After': '30' } });
        });
        const res = await app.request('/orders/1', { method: 'POST' });
        expect(res.status).toBe(423);
        expect(res.headers.get('Retry-After')).toBe('30');
        expect(await res.json()).toEqual({ error: 'The order is being edited', status: 423, code: 'ORDER_LOCKED' });
    });

    it("gives an HttpError its status's code when none is given", () => {
        expect(new HttpError(429, 'Slow down').code).toBe('RATE_LIMITED');
        expect(new HttpError(418, "I'm a teapot").code).toBe('BAD_REQUEST');
        expect(new HttpError(502, 'Bad gateway').code).toBe('INTERNAL_ERROR');
    });

    it('answers a failed validation with its details', async () => {
        const app = (await kernel()).getApp();
        app.post('/users', validate({ body: z.object({ name: z.string() }) }), (c) => c.json({}));
        const res = await app.request('/users', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 1 }),
        });
        expect(res.status).toBe(400);
        const body = (await res.json()) as Record<string, unknown>;
        expect(body).toMatchObject({ error: 'Invalid body', status: 400, code: 'VALIDATION_ERROR' });
        expect(body.details).toBeDefined();
    });

    it('builds successes and pages with ok() and list()', async () => {
        const app = (await kernel()).getApp();
        app.get('/one', (c) => ok(c, { id: 1 }, { message: 'found' }));
        app.post('/one', (c) => ok(c, { id: 2 }, { status: 201 }));
        app.get('/many', (c) => list(c, { rows: [{ id: 1 }], total: 10, filtered: 1, offset: 0, limit: 20, pages: 1 }));

        expect(await (await app.request('/one')).json()).toEqual({ success: true, data: { id: 1 }, message: 'found' });
        expect((await app.request('/one', { method: 'POST' })).status).toBe(201);
        expect(await (await app.request('/many')).json()).toEqual({
            success: true,
            data: [{ id: 1 }],
            meta: { total: 10, filtered: 1, offset: 0, limit: 20, pages: 1 },
        });
    });

    it('answers an error without throwing with fail()', async () => {
        const app = (await kernel()).getApp();
        app.get('/gone', (c) => fail(c, new NotFoundError('Gone')));
        const res = await app.request('/gone');
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: 'Gone', status: 404, code: 'NOT_FOUND' });
    });

    it('still honors ErrorHandlerFeature: a handler per status', async () => {
        const app = (
            await kernel(
                {},
                new ErrorHandlerFeature({
                    customHandlers: { 404: (_err, c) => c.text('custom 404', 404) },
                }),
            )
        ).getApp();
        app.get('/user', () => {
            throw new NotFoundError();
        });
        expect(await (await app.request('/user')).text()).toBe('custom 404');
    });
});

describe('problemDetailsContract()', () => {
    it('answers RFC 9457 problem details, keeping the headers set before', async () => {
        const app = (
            await kernel(
                { contract: problemDetailsContract({ type: (p) => `https://errors.example.com/${p.code}` }) },
                new RateLimitFeature({ max: 1, windowMs: 60_000 }),
            )
        ).getApp();
        app.get('/x', (c) => c.text('ok'));
        await app.request('/x');
        const res = await app.request('/x');

        expect(res.status).toBe(429);
        expect(res.headers.get('content-type')).toBe('application/problem+json');
        expect(res.headers.get('Retry-After')).not.toBeNull();
        expect(await res.json()).toEqual({
            type: 'https://errors.example.com/RATE_LIMITED',
            title: 'Too Many Requests',
            status: 429,
            detail: 'Too many requests',
            code: 'RATE_LIMITED',
            instance: '/x',
        });
    });
});

describe('a custom contract', () => {
    class OrderError extends Error {
        constructor(readonly reason: 'locked' | 'missing') {
            super(reason);
        }
    }

    const logged: Problem[] = [];
    const contract: ResponseContract = {
        toProblem: (error) =>
            error instanceof OrderError
                ? error.reason === 'locked'
                    ? { status: 409, code: 'ORDER_LOCKED', message: 'Locked' }
                    : { status: 404, code: 'NOT_FOUND', message: 'No such order' }
                : undefined,
        error: (problem) => ({ message: problem.message }),
        log: (problem) => logged.push(problem),
    };

    it('recognizes its own errors, shapes every body and sees every problem', async () => {
        const app = (await kernel({ contract })).getApp();
        app.get('/orders/:id', (c) => {
            throw new OrderError(c.req.param('id') === '1' ? 'locked' : 'missing');
        });
        app.post('/orders', validate({ body: z.object({ total: z.number() }) }), (c) => c.json({}));

        const locked = await app.request('/orders/1');
        expect(locked.status).toBe(409);
        expect(await locked.json()).toEqual({ message: 'Locked' });
        expect(await (await app.request('/orders/2')).json()).toEqual({ message: 'No such order' });
        expect(await (await app.request('/nowhere')).json()).toEqual({ message: 'Not Found' });
        const invalid = await app.request('/orders', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
        });
        expect(invalid.status).toBe(400);

        expect(logged.map((p) => p.status)).toEqual([409, 404, 404, 400]);
    });
});

describe('securityHeaders: false', () => {
    it('sets none of the default headers', async () => {
        const on = (await kernel()).getApp();
        const off = (await kernel({ securityHeaders: false })).getApp();
        for (const app of [on, off]) app.get('/', (c) => c.text('ok'));
        expect((await on.request('/')).headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
        const res = await off.request('/');
        expect(res.headers.get('X-Frame-Options')).toBeNull();
        expect(res.headers.get('X-Content-Type-Options')).toBeNull();
        expect(res.headers.get('Referrer-Policy')).toBeNull();
    });
});
