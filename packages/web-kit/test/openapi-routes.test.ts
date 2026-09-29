import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { z } from 'zod';
import { z as z4 } from '@hono/zod-openapi';
import {
    Router,
    anyOf,
    apiKey,
    bearer,
    describeRoute,
    documentRoutes,
    identify,
    jwt,
    allOf,
    problemDetailsContract,
    requireActor,
    requireScopes,
    session,
    staticKeys,
    validate,
    validateJson,
} from '../src/index';
import { OpenAPIFeature, createRoute } from '../src/features/openapi';
import { createTestKernel } from '../src/testing';
import type { OpenAPIConfig, ResponseContract } from '../src/index';

type Spec = {
    paths: Record<string, Record<string, any>>;
    components?: { schemas?: Record<string, any>; securitySchemes?: Record<string, any> };
};

/** documentRoutes(), its operations readable in assertions. */
const routesDoc = (...args: Parameters<typeof documentRoutes>) =>
    documentRoutes(...args) as {
        paths: Record<string, Record<string, any>>;
        schemas: Record<string, any>;
        securitySchemes: Record<string, any>;
    };

const users = bearer(async (token) => (token === 'ok' ? { kind: 'user', id: '1' } : null));
const keys = apiKey(staticKeys([{ key: 'k', id: 'svc' }]));

async function specOf(router: Router | Hono, config: Partial<OpenAPIConfig> = {}, contract?: ResponseContract) {
    const kit = await createTestKernel({
        router,
        features: [new OpenAPIFeature({ title: 'API', version: '1', ...config })],
        ...(contract ? { contract } : {}),
    });
    return { kit, spec: (await (await kit.request('/openapi.json')).json()) as Spec };
}

describe('OpenAPI of plain routes', () => {
    it('documents a route from its group, its validate() and its gates', async () => {
        const router = new Router();
        const api = router.group('/api/users', describeRoute({ tags: ['Users'] }), requireActor(anyOf(users, keys)));
        api.get(
            '/:id',
            describeRoute({ summary: 'A user', ok: z.object({ id: z.number(), name: z.string() }) }),
            validate({
                params: z.object({ id: z.coerce.number().int() }),
                query: z.object({ fields: z.array(z.string()).optional() }),
            }),
            (c) => c.json({}),
        );
        api.post(
            '',
            describeRoute({
                summary: 'Create a user',
                tags: ['Admin'],
                responses: { 201: { schema: z.object({ id: z.number() }) } },
            }),
            validate(
                { body: z.object({ name: z.string().min(1), email: z.string().email().optional() }) },
                { allowForm: false },
            ),
            (c) => c.json({}, 201),
        );

        const { spec } = await specOf(router);
        const get = spec.paths['/api/users/{id}']!.get;

        expect(get.tags).toEqual(['Users']);
        expect(get.summary).toBe('A user');
        expect(get.parameters).toEqual([
            { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
            { name: 'fields', in: 'query', schema: { type: 'array', items: { type: 'string' } } },
        ]);
        // ok() goes through the contract: { success, data, message }.
        expect(get.responses['200'].content['application/json'].schema).toMatchObject({
            properties: { success: { const: true }, data: { properties: { id: { type: 'number' } } } },
        });
        const error = { $ref: '#/components/schemas/ErrorResponse' };
        expect(get.responses['400'].content['application/json'].schema).toEqual(error);
        expect(get.responses['401'].content['application/json'].schema).toEqual(error);
        expect(get.responses.default.content['application/json'].schema).toEqual(error);
        expect(get.security).toEqual([{ bearer: [] }, { apiKey: [] }]);

        const post = spec.paths['/api/users']!.post;
        expect(post.tags).toEqual(['Users', 'Admin']);
        expect(Object.keys(post.requestBody.content)).toEqual(['application/json']);
        expect(post.requestBody.content['application/json'].schema).toMatchObject({
            properties: { name: { type: 'string', minLength: 1 } },
            required: ['name'],
        });
        expect(post.responses['201'].description).toBe('Created');
        expect(post.responses['200']).toBeUndefined();

        expect(spec.components?.securitySchemes).toEqual({
            bearer: { type: 'http', scheme: 'bearer' },
            apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
        });
        expect(spec.components?.schemas?.ErrorResponse.required).toEqual(['error', 'status', 'code']);
    });

    it('lists only described routes by default, every route with routes: all, never the hidden ones', async () => {
        const router = new Router();
        router.get('/described', describeRoute({ summary: 'Yes' }), (c) => c.text('ok'));
        router.get('/plain', (c) => c.text('ok'));
        router.get('/hidden', describeRoute({ hidden: true }), (c) => c.text('ok'));
        router.all('/any', (c) => c.text('ok'));

        const described = (await specOf(router)).spec;
        expect(Object.keys(described.paths)).toEqual(['/described']);

        const all = (await specOf(router, { routes: 'all' })).spec;
        // Not the docs' own routes, nor a route for every method.
        expect(Object.keys(all.paths).sort()).toEqual(['/described', '/plain']);
        expect(all.paths['/plain']!.get.responses).toMatchObject({ '200': { description: 'OK' } });

        const none = (await specOf(router, { routes: false })).spec;
        expect(none.paths).toEqual({});
    });

    it('applies app.use() middleware to the routes registered after it, not to other routes', async () => {
        const app = new Hono();
        app.get('/before', describeRoute({ summary: 'Before' }), (c) => c.text('ok'));
        app.use('/api/*', describeRoute({ tags: ['Api'] }), requireActor(users));
        app.get('/api/users/:id', describeRoute({ summary: 'By id', deprecated: true }), (c) => c.text('ok'));
        app.get('/api/users/me', describeRoute({ summary: 'Me' }), (c) => c.text('ok'));
        app.get('/api', describeRoute({ summary: 'Root' }), (c) => c.text('ok'));

        const doc = routesDoc(app.routes);
        expect(doc.paths['/before']!.get).not.toHaveProperty('tags');
        expect(doc.paths['/api/users/{id}']!.get).toMatchObject({ tags: ['Api'], security: [{ bearer: [] }] });
        // /api/users/:id matches /api/users/me, but it is a route, not middleware.
        expect(doc.paths['/api/users/me']!.get).toMatchObject({ summary: 'Me', tags: ['Api'] });
        expect(doc.paths['/api/users/me']!.get).not.toHaveProperty('deprecated');
        // Hono's /api/* also matches /api.
        expect(doc.paths['/api']!.get.tags).toEqual(['Api']);
    });

    it('turns optional and regex parameters into OpenAPI paths', () => {
        const app = new Hono();
        app.get('/posts/:id{[0-9]+}/:slug?', describeRoute({}), (c) => c.text('ok'));

        const doc = routesDoc(app.routes);
        expect(Object.keys(doc.paths)).toEqual(['/posts/{id}', '/posts/{id}/{slug}']);
        expect(doc.paths['/posts/{id}/{slug}']!.get.parameters).toEqual([
            { name: 'id', in: 'path', required: true, schema: { type: 'string', pattern: '^[0-9]+$' } },
            { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
        ]);
    });

    it('states identify(), requireScopes(), allOf() and the other gates', () => {
        const app = new Hono();
        app.get('/feed', describeRoute({}), identify(session()), (c) => c.text('ok'));
        app.get(
            '/admin',
            describeRoute({}),
            requireActor(anyOf(jwt({ secret: 's' }), apiKey(staticKeys([]), { header: 'X-Key', query: 'key' }))),
            requireScopes('admin'),
            (c) => c.text('ok'),
        );
        app.get('/both', describeRoute({}), requireActor(allOf(users, keys)), (c) => c.text('ok'));
        app.get(
            '/twice',
            describeRoute({}),
            requireActor(anyOf(users, apiKey(staticKeys([]), { bearer: true }))),
            (c) => c.text('ok'),
        );
        const custom = Object.assign(async () => null, {});
        app.get('/custom', describeRoute({}), requireActor(custom), (c) => c.text('ok'));
        app.get('/public', describeRoute({ security: [] }), requireActor(users), (c) => c.text('ok'));

        const doc = routesDoc(app.routes);
        expect(doc.paths['/feed']!.get.security).toEqual([{ session: [] }, {}]);
        expect(doc.paths['/feed']!.get.responses['401']).toBeUndefined();

        const admin = doc.paths['/admin']!.get;
        expect(admin.security).toEqual([
            { jwt: ['admin'] },
            { 'apiKey.X-Key': ['admin'] },
            { 'apiKey.query.key': ['admin'] },
        ]);
        expect(admin.responses['403']).toEqual({ description: 'Missing scopes' });

        expect(doc.paths['/both']!.get.security).toEqual([{ bearer: [], apiKey: [] }]);
        expect(doc.paths['/twice']!.get.security).toEqual([{ bearer: [] }, { apiKey: [] }]);
        // A gate that states nothing: a 401, no security requirement.
        expect(doc.paths['/custom']!.get.security).toBeUndefined();
        expect(doc.paths['/custom']!.get.responses['401']).toBeDefined();
        expect(doc.paths['/public']!.get.security).toEqual([]);

        expect(doc.securitySchemes).toMatchObject({
            session: { type: 'apiKey', in: 'cookie', name: 'better-auth.session_token' },
            jwt: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
            'apiKey.X-Key': { type: 'apiKey', in: 'header', name: 'X-Key' },
            'apiKey.query.key': { type: 'apiKey', in: 'query', name: 'key' },
        });
    });

    it('converts Zod v3, Zod v4 and JSON Schema, and moves named Zod v4 schemas to the components', () => {
        const User = z4.object({ id: z4.number(), createdAt: z4.date() }).meta({ id: 'User' });
        const app = new Hono();
        app.get('/v4', describeRoute({ list: User }), (c) => c.text('ok'));
        app.post(
            '/json',
            describeRoute({}),
            validateJson({ body: { type: 'object', properties: { n: { type: 'integer' } }, required: ['n'] } }),
            (c) => c.text('ok'),
        );
        app.get(
            '/v3',
            describeRoute({ ok: z.object({ when: z.date(), kind: z.enum(['a', 'b']).default('a') }) }),
            (c) => c.text('ok'),
        );

        const doc = routesDoc(app.routes, { contract: problemDetailsContract() });
        const list = doc.paths['/v4']!.get.responses['200'].content['application/json'].schema;
        expect(list.properties.data).toEqual({ type: 'array', items: { $ref: '#/components/schemas/User' } });
        expect(doc.schemas.User).toMatchObject({
            type: 'object',
            properties: { id: { type: 'number' }, createdAt: {} },
        });

        const json = doc.paths['/json']!.post.requestBody.content;
        expect(Object.keys(json)).toEqual([
            'application/json',
            'application/x-www-form-urlencoded',
            'multipart/form-data',
        ]);
        expect(json['application/json'].schema).toEqual({
            type: 'object',
            properties: { n: { type: 'integer' } },
            required: ['n'],
        });

        const v3 = doc.paths['/v3']!.get.responses['200'].content['application/json'].schema.properties.data;
        expect(v3.properties).toEqual({
            when: { type: 'string', format: 'date-time' },
            kind: { type: 'string', enum: ['a', 'b'], default: 'a' },
        });
        // Problem details: the errors' media type.
        expect(Object.keys(doc.paths['/json']!.post.responses['400'].content)).toEqual(['application/problem+json']);
    });

    it('leaves addRoute() operations as they are', async () => {
        const app = new Hono();
        app.get('/pets', describeRoute({ summary: 'Plain' }), (c) => c.json([]));
        app.post('/pets', describeRoute({ summary: 'Plain post' }), (c) => c.json({}));
        const openapi = new OpenAPIFeature({ title: 'API', version: '1' });
        openapi.addRoute(
            createRoute({ method: 'get', path: '/pets', summary: 'Typed', responses: { 200: { description: 'ok' } } }),
            ((c: any) => c.json([])) as any,
        );
        const kit = await createTestKernel({ router: app, features: [openapi] });

        const spec = (await (await kit.request('/openapi.json')).json()) as Spec;
        expect(spec.paths['/pets']!.get.summary).toBe('Typed');
        expect(spec.paths['/pets']!.post.summary).toBe('Plain post');
    });

    it('documents the errors without a body schema when the contract has none', () => {
        const app = new Hono();
        app.post('/x', describeRoute({}), validate({ body: z.object({}) }), (c) => c.text('ok'));
        const doc = routesDoc(app.routes, { contract: { error: (p) => ({ message: p.message }) } });
        expect(doc.paths['/x']!.post.responses).toEqual({
            '200': { description: 'OK' },
            '400': { description: 'Invalid request' },
        });
    });
});

describe('OpenAPIFeature local Scalar', () => {
    const bundle = 'console.log("scalar");';
    const integrity = `sha384-${createHash('sha384').update(bundle).digest('base64')}`;

    function withBundle<T>(fn: (dir: string) => Promise<T>): Promise<T> {
        const dir = mkdtempSync(join(tmpdir(), 'iskra-scalar-'));
        return fn(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
    }

    it('serves the bundle of `scalar: { file }` from the app, with its SRI hash and a self-only CSP', () =>
        withBundle(async (dir) => {
            const file = join(dir, 'standalone.js');
            writeFileSync(file, bundle);
            const { kit } = await specOf(new Hono(), { scalar: { file } });

            const page = await kit.request('/docs');
            expect(await page.text()).toContain(`<script src="/docs/scalar.js" integrity="${integrity}"`);
            expect(page.headers.get('Content-Security-Policy')).toContain("script-src 'self';");

            const script = await kit.request('/docs/scalar.js');
            expect(script.headers.get('Content-Type')).toBe('text/javascript; charset=utf-8');
            expect(await script.text()).toBe(bundle);
            const etag = script.headers.get('ETag')!;
            expect((await kit.request('/docs/scalar.js', { headers: { 'If-None-Match': etag } })).status).toBe(304);
        }));

    it('finds the installed @scalar/api-reference with scalar: local', () =>
        withBundle(async (dir) => {
            const pkg = join(dir, 'node_modules', '@scalar', 'api-reference');
            mkdirSync(join(pkg, 'dist', 'browser'), { recursive: true });
            writeFileSync(
                join(pkg, 'package.json'),
                JSON.stringify({
                    name: '@scalar/api-reference',
                    exports: { '.': { import: './dist/index.js', default: './dist/index.js' } },
                }),
            );
            writeFileSync(join(pkg, 'dist', 'index.js'), 'export {};');
            writeFileSync(join(pkg, 'dist', 'browser', 'standalone.js'), bundle);
            const cwd = process.cwd();
            process.chdir(dir);
            try {
                const { kit } = await specOf(new Hono(), { scalar: 'local' });
                expect(await (await kit.request('/docs')).text()).toContain(`integrity="${integrity}"`);
                expect(await (await kit.request('/docs/scalar.js')).text()).toBe(bundle);
            } finally {
                process.chdir(cwd);
            }
        }));

    it('fails at startup when scalar: local has no package to serve', () =>
        withBundle(async (dir) => {
            const cwd = process.cwd();
            process.chdir(dir);
            try {
                await expect(specOf(new Hono(), { scalar: 'local' })).rejects.toThrow('@scalar/api-reference');
            } finally {
                process.chdir(cwd);
            }
        }));
});
