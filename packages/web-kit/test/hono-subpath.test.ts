import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as honoRoot from 'hono';
import { HTTPException as RootHTTPException } from 'hono/http-exception';
// Through the package name on purpose: this checks the `./hono` entry of the exports map.
import { HTTPException, Hono, createMiddleware, isHTTPException, statusText } from '@iskra-bun/web-kit/hono';
import { ErrorHandlerFeature, HttpError, Kernel } from '../src/index';

/** A HTTPException from a second copy of hono: same shape, another class. */
class ForeignHTTPException extends Error {
    readonly res?: Response;
    constructor(
        readonly status: number,
        options: { message?: string; res?: Response } = {},
    ) {
        super(options.message);
        this.res = options.res;
    }
    getResponse(): Response {
        return this.res ?? new Response(this.message, { status: this.status });
    }
}

describe('@iskra-bun/web-kit/hono', () => {
    it('re-exports the same Hono and HTTPException as hono itself', () => {
        expect(Hono).toBe(honoRoot.Hono);
        expect(HTTPException).toBe(RootHTTPException);
        expect(typeof createMiddleware).toBe('function');
    });

    it('declares hono as a peer dependency, not a dependency of its own', () => {
        const manifest = JSON.parse(readFileSync(join(import.meta.dir, '..', 'package.json'), 'utf8'));
        expect(manifest.dependencies.hono).toBeUndefined();
        expect(manifest.peerDependencies.hono).toBeDefined();
    });

    it('recognizes a HTTPException from this copy of hono or another one', () => {
        expect(isHTTPException(new HTTPException(401))).toBe(true);
        expect(isHTTPException(new ForeignHTTPException(418))).toBe(true);

        expect(isHTTPException(new HttpError(404, 'Not found'))).toBe(false);
        expect(isHTTPException(new Error('plain'))).toBe(false);
        expect(isHTTPException(new ForeignHTTPException(42))).toBe(false);
        expect(isHTTPException({ status: 401, getResponse: () => new Response() })).toBe(false);
        expect(isHTTPException(undefined)).toBe(false);
    });

    it('gives the reason phrase of a status', () => {
        expect(statusText(404)).toBe('Not Found');
        expect(statusText(500)).toBe('Internal Server Error');
        expect(statusText(799)).toBe('');
    });
});

describe('a HTTPException from another copy of hono', () => {
    it('keeps its status with the Kernel default error handler', async () => {
        const kernel = new Kernel({ logger: false });
        await kernel.initialize();
        const app = kernel.getApp();
        app.get('/denied', () => {
            throw new ForeignHTTPException(403, { message: 'Denied' });
        });
        app.get('/custom', () => {
            throw new ForeignHTTPException(401, {
                res: new Response('Unauthorized', { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } }),
            });
        });

        const denied = await app.request('/denied');
        expect(denied.status).toBe(403);
        expect(await denied.json()).toEqual({ error: 'Denied', status: 403, code: 'FORBIDDEN' });

        const custom = await app.request('/custom');
        expect(custom.status).toBe(401);
        expect(custom.headers.get('WWW-Authenticate')).toBe('Bearer');
    });

    it('keeps its status with ErrorHandlerFeature', async () => {
        const kernel = new Kernel({ logger: false });
        kernel.registerFeature(new ErrorHandlerFeature({ includeStack: false }));
        await kernel.initialize();
        kernel.getApp().get('/denied', () => {
            throw new ForeignHTTPException(403, { message: 'Denied' });
        });

        const res = await kernel.getApp().request('/denied');
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: 'Denied', status: 403, code: 'FORBIDDEN' });
    });
});
