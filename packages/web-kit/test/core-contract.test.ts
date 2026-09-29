import { describe, expect, it } from 'bun:test';
import { ErrorCodes } from '@iskra-bun/core';
import { Kernel, fail, list, ok, type ResponseContract } from '../src/index';
import { HTTPException, type Context } from '../src/hono';

// Acceptance test: the responses of a service migrated from Go's Echo (core),
// written as a response contract instead of its own notFound/onError, error
// envelope and list helpers. The expected bodies are byte for byte what the
// Go service answers (key order included).

type Kind = 'validation' | 'not_found' | 'conflict' | 'internal';

/** The service's error: a kind, a message and the fields that failed. */
class AppError extends Error {
    constructor(
        readonly kind: Kind,
        message: string,
        readonly fields?: Record<string, string>,
        readonly metadata?: unknown,
    ) {
        super(message);
    }
}

const STATUS: Record<Kind, number> = { validation: 400, not_found: 404, conflict: 409, internal: 500 };
const CODE = {
    validation: ErrorCodes.VALIDATION_ERROR,
    not_found: ErrorCodes.NOT_FOUND,
    conflict: ErrorCodes.CONFLICT,
    internal: ErrorCodes.INTERNAL_ERROR,
} as const;

/** encoding/json writes a map with its keys sorted. */
const sortedKeys = (record: Record<string, string>) =>
    Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/** Go's APIResponse: every field `omitempty`, in the struct's order. */
function apiResponse(init: { message?: string; data?: unknown; recordsTotal?: number; totalPages?: number }) {
    return {
        ...(init.message ? { message: init.message } : {}),
        ...(init.data !== undefined ? { data: init.data } : {}),
        ...(init.recordsTotal ? { recordsTotal: init.recordsTotal } : {}),
        ...(init.totalPages ? { totalPages: init.totalPages } : {}),
    };
}

const coreContract: ResponseContract = {
    toProblem: (error) =>
        error instanceof AppError
            ? {
                  status: STATUS[error.kind],
                  code: CODE[error.kind],
                  message: error.kind === 'internal' ? 'Error interno del servidor' : error.message,
              }
            : undefined,
    error: (problem, _c, error) => {
        if (error instanceof AppError) {
            const hasFields = error.fields !== undefined && Object.keys(error.fields).length > 0;
            const metadata = error.metadata ?? (hasFields ? sortedKeys(error.fields!) : []);
            return { error: { code: problem.status, message: problem.message, metadata } };
        }
        // Echo's DefaultHTTPErrorHandler: {"message": StatusText} (HEAD gets no body anyway).
        return { message: problem.message };
    },
    success: (data, _c, { message }) => apiResponse({ message, data }),
    // DataTables: no omitempty, and draw null when the request did not send it.
    list: (page, c) => {
        const draw = c.req.query('draw');
        return {
            draw: draw === undefined ? null : Number(draw),
            recordsTotal: page.total,
            recordsFiltered: page.filtered,
            data: page.items,
        };
    },
};

/** The service's writeError: nothing to write for no error (200, no body). */
const writeError = (c: Context, error: unknown) => (error == null ? c.body(null, 200) : fail(c, error));

async function core() {
    const kernel = new Kernel({ logger: false, contract: coreContract });
    await kernel.initialize();
    const app = kernel.getApp();
    app.get('/api/users/:id', (c) => {
        const id = c.req.param('id');
        if (id === 'x') throw new AppError('validation', 'Datos inválidos', { nombre: 'requerido', edad: 'numérico' });
        if (id === '0') throw new AppError('not_found', 'Recurso no encontrado');
        if (id === '9') throw new AppError('internal', 'ORA-00942: table or view does not exist');
        return ok(c, { id: Number(id) });
    });
    app.post('/api/users', (c) => ok(c, { id: 7 }, { message: 'Usuario creado', status: 201 }));
    app.get('/api/users', (c) => list(c, { rows: [{ id: 1 }], total: 25, filtered: 1 }));
    app.get('/api/locked', () => {
        throw new HTTPException(423);
    });
    app.get('/api/boom', () => {
        throw new TypeError('cannot read properties of undefined');
    });
    app.delete('/api/users/:id', (c) =>
        writeError(c, c.req.param('id') === '1' ? null : new AppError('conflict', 'Tiene pedidos')),
    );
    return app;
}

const bodyOf = async (res: Response) => ({
    status: res.status,
    type: res.headers.get('content-type'),
    text: await res.text(),
});

describe("core's contract on Iskra's", () => {
    it('an unknown route: 404 {"message":"Not Found"}', async () => {
        const app = await core();
        expect(await bodyOf(await app.request('/api/nowhere'))).toEqual({
            status: 404,
            type: 'application/json',
            text: '{"message":"Not Found"}',
        });
    });

    it('HEAD: no body and no content type', async () => {
        const app = await core();
        expect(await bodyOf(await app.request('/api/nowhere', { method: 'HEAD' }))).toEqual({
            status: 404,
            type: null,
            text: '',
        });
    });

    it("a HTTPException: its status and Echo's status text", async () => {
        const app = await core();
        expect(await bodyOf(await app.request('/api/locked'))).toEqual({
            status: 423,
            type: 'application/json',
            text: '{"message":"Locked"}',
        });
    });

    it('an unhandled error: 500 without the error', async () => {
        const app = await core();
        expect(await bodyOf(await app.request('/api/boom'))).toEqual({
            status: 500,
            type: 'application/json',
            text: '{"message":"Internal Server Error"}',
        });
    });

    it("the service's errors: the PHP envelope, fields sorted, internal ones hidden", async () => {
        const app = await core();
        expect((await bodyOf(await app.request('/api/users/x'))).text).toBe(
            '{"error":{"code":400,"message":"Datos inválidos","metadata":{"edad":"numérico","nombre":"requerido"}}}',
        );
        expect((await bodyOf(await app.request('/api/users/0'))).text).toBe(
            '{"error":{"code":404,"message":"Recurso no encontrado","metadata":[]}}',
        );
        expect(await bodyOf(await app.request('/api/users/9'))).toEqual({
            status: 500,
            type: 'application/json',
            text: '{"error":{"code":500,"message":"Error interno del servidor","metadata":[]}}',
        });
    });

    it('writeError: no error writes nothing, an error answers by the contract', async () => {
        const app = await core();
        expect(await bodyOf(await app.request('/api/users/1', { method: 'DELETE' }))).toEqual({
            status: 200,
            type: null,
            text: '',
        });
        expect((await bodyOf(await app.request('/api/users/2', { method: 'DELETE' }))).text).toBe(
            '{"error":{"code":409,"message":"Tiene pedidos","metadata":[]}}',
        );
    });

    it('successes and lists: omitempty APIResponse and DataTables', async () => {
        const app = await core();
        expect((await bodyOf(await app.request('/api/users/3'))).text).toBe('{"data":{"id":3}}');
        const created = await bodyOf(await app.request('/api/users', { method: 'POST' }));
        expect(created.status).toBe(201);
        expect(created.text).toBe('{"message":"Usuario creado","data":{"id":7}}');
        expect((await bodyOf(await app.request('/api/users?draw=3'))).text).toBe(
            '{"draw":3,"recordsTotal":25,"recordsFiltered":1,"data":[{"id":1}]}',
        );
        expect((await bodyOf(await app.request('/api/users'))).text).toBe(
            '{"draw":null,"recordsTotal":25,"recordsFiltered":1,"data":[{"id":1}]}',
        );
    });
});
