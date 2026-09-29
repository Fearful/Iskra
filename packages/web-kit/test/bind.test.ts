import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { Kernel, bindBody, bindQuery, queryParams, validate, type ResponseContract } from '../src/index';
import type { Context } from '../src/hono';

async function appWith(route: (c: Context) => Promise<Response> | Response, contract?: ResponseContract) {
    const kernel = new Kernel({ logger: false, ...(contract ? { contract } : {}) });
    await kernel.initialize();
    const app = kernel.getApp();
    app.all('/x', route);
    return app;
}

const json = (body: unknown): RequestInit => ({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
});

const person = z.object({
    nombre: z.string(),
    edad: z.number().optional(),
    domicilio: z.object({ ciudad: z.string() }).optional(),
    hijos: z.array(z.object({ nombre: z.string() })).optional(),
});

describe('bindBody()', () => {
    it('parses a JSON body, typed', async () => {
        const app = await appWith(async (c) => c.json(await bindBody(c, person)));
        expect(await (await app.request('/x', json({ nombre: 'Ana', edad: 30 }))).json()).toEqual({
            nombre: 'Ana',
            edad: 30,
        });
    });

    it('matches keys ignoring case, nested objects and arrays included', async () => {
        const app = await appWith(async (c) => c.json(await bindBody(c, person, { caseInsensitiveKeys: true })));
        const res = await app.request(
            '/x',
            json({ NOMBRE: 'Ana', Domicilio: { CIUDAD: 'Rosario' }, HIJOS: [{ Nombre: 'Leo' }] }),
        );
        expect(await res.json()).toEqual({
            nombre: 'Ana',
            domicilio: { ciudad: 'Rosario' },
            hijos: [{ nombre: 'Leo' }],
        });

        const strict = await appWith(async (c) => c.json(await bindBody(c, person)));
        expect((await strict.request('/x', json({ NOMBRE: 'Ana' }))).status).toBe(400);
    });

    it('answers a failed validation with a 400 and the failed fields', async () => {
        const app = await appWith(async (c) => c.json(await bindBody(c, person, { details: 'fields' })));
        const res = await app.request('/x', json({ edad: 'treinta' }));
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({
            error: 'Invalid body',
            status: 400,
            code: 'VALIDATION_ERROR',
            details: { nombre: ['Required'], edad: ['Expected number, received string'] },
        });
    });

    it('formats the details as the contract says, or with a function', async () => {
        const contract: ResponseContract = {
            validationDetails: 'issues',
            error: (problem) => ({ message: problem.message, errors: problem.details }),
        };
        const byContract = await appWith(async (c) => c.json(await bindBody(c, person)), contract);
        expect(await (await byContract.request('/x', json({}))).json()).toEqual({
            message: 'Invalid body',
            errors: [{ path: 'nombre', message: 'Required', code: 'invalid_type' }],
        });

        const byFunction = await appWith(async (c) =>
            c.json(await bindBody(c, person, { details: (issues) => issues.map((i) => i.path) })),
        );
        expect(((await (await byFunction.request('/x', json({}))).json()) as { details: unknown }).details).toEqual([
            'nombre',
        ]);
    });

    it('answers malformed JSON with 400, another content type with 415, and binds an empty body as {}', async () => {
        const optional = z.object({ nota: z.string().optional() });
        const app = await appWith(async (c) => c.json(await bindBody(c, optional)));

        const malformed = await app.request('/x', json('{"nombre":'));
        expect(malformed.status).toBe(400);
        expect(((await malformed.json()) as { code: string }).code).toBe('BAD_REQUEST');

        const form = await app.request('/x', {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: 'nota=hola',
        });
        expect(form.status).toBe(415);
        expect(await form.json()).toEqual({
            error: 'Unsupported content type: application/x-www-form-urlencoded',
            status: 415,
            code: 'UNSUPPORTED_MEDIA_TYPE',
        });

        expect(await (await app.request('/x', { method: 'POST' })).json()).toEqual({});
        expect(await (await app.request('/x', json(''))).json()).toEqual({});
    });

    it('takes a form with allowForm, repeated fields as arrays', async () => {
        const schema = z.object({ nombre: z.string(), tags: z.array(z.string()) });
        const app = await appWith(async (c) => c.json(await bindBody(c, schema, { allowForm: true })));
        const res = await app.request('/x', {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: 'nombre=Ana&tags=a&tags=b',
        });
        expect(await res.json()).toEqual({ nombre: 'Ana', tags: ['a', 'b'] });
    });
});

describe('queryParams() and bindQuery()', () => {
    it('keeps every value of a repeated parameter', async () => {
        const app = await appWith((c) => c.json(queryParams(c)));
        expect(await (await app.request('/x?id=1&id=2&q=ana')).json()).toEqual({ id: ['1', '2'], q: 'ana' });
    });

    it('gives an array field every value and the others the first', async () => {
        const schema = z.object({ ids: z.array(z.coerce.number()).optional(), q: z.string().optional() });
        const app = await appWith((c) => c.json(bindQuery(c, schema, { caseInsensitiveKeys: true })));
        // `q` exactly wins over `Q`, whichever comes first.
        expect(await (await app.request('/x?ids=1&ids=2&Q=a&q=b')).json()).toEqual({ ids: [1, 2], q: 'b' });
        expect(await (await app.request('/x?q=b&Q=a')).json()).toEqual({ q: 'b' });
        expect(await (await app.request('/x?Q=a')).json()).toEqual({ q: 'a' });
        expect(await (await app.request('/x?ids=7')).json()).toEqual({ ids: [7] });
    });

    it('answers invalid query params with a 400', async () => {
        const app = await appWith((c) => c.json(bindQuery(c, z.object({ page: z.coerce.number().int() }))));
        const res = await app.request('/x?page=abc');
        expect(res.status).toBe(400);
        expect(((await res.json()) as { error: string }).error).toBe('Invalid query params');
    });
});

describe('validate() options', () => {
    it('matches keys ignoring case and reads repeated query parameters', async () => {
        const kernel = new Kernel({ logger: false });
        await kernel.initialize();
        const app = kernel.getApp();
        app.post(
            '/users',
            validate(
                { body: z.object({ nombre: z.string() }), query: z.object({ ids: z.array(z.string()) }) },
                { caseInsensitiveKeys: true },
            ),
            (c) => c.json(c.get('validated')),
        );
        const res = await app.request('/users?ids=a&ids=b', json({ Nombre: 'Ana' }));
        expect(await res.json()).toEqual({ body: { nombre: 'Ana' }, query: { ids: ['a', 'b'] } });
    });
});
