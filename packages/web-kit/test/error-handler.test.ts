import { describe, expect, it } from 'bun:test';
import { Kernel } from '../src/kernel';
import { ErrorHandlerFeature } from '../src/features/error-handler';
import { HttpError, NotFoundError, ValidationError, AuthError, ForbiddenError } from '../src/errors';
import { DriverError } from '@iskra-bun/core';
import { HTTPException } from 'hono/http-exception';

describe('Error Handler Feature', () => {
    async function createKernelWithErrorHandler(includeStack = false) {
        const kernel = new Kernel();
        kernel.registerFeature(new ErrorHandlerFeature({ includeStack }));
        await kernel.initialize();
        return kernel;
    }

    it('should handle HttpError and return correct status', async () => {
        const kernel = await createKernelWithErrorHandler();
        const app = kernel.getApp();

        app.get('/not-found', () => {
            throw new NotFoundError('User not found');
        });

        const res = await app.request('/not-found');
        expect(res.status).toBe(404);
        const json = (await res.json()) as any;
        expect(json.error).toBe('User not found');
        expect(json.code).toBe('NOT_FOUND');

        await kernel.shutdown();
    });

    it('should handle ValidationError with details', async () => {
        const kernel = await createKernelWithErrorHandler();
        const app = kernel.getApp();

        app.get('/validate', () => {
            throw new ValidationError('Invalid input', { field: 'email', issue: 'required' });
        });

        const res = await app.request('/validate');
        expect(res.status).toBe(400);
        const json = (await res.json()) as any;
        expect(json.error).toBe('Invalid input');
        expect(json.code).toBe('VALIDATION_ERROR');
        expect(json.details).toEqual({ field: 'email', issue: 'required' });

        await kernel.shutdown();
    });

    it('should handle AuthError as 401', async () => {
        const kernel = await createKernelWithErrorHandler();
        const app = kernel.getApp();

        app.get('/auth', () => {
            throw new AuthError();
        });

        const res = await app.request('/auth');
        expect(res.status).toBe(401);
        const json = (await res.json()) as any;
        expect(json.code).toBe('UNAUTHORIZED');

        await kernel.shutdown();
    });

    it('should handle ForbiddenError as 403', async () => {
        const kernel = await createKernelWithErrorHandler();
        const app = kernel.getApp();

        app.get('/forbidden', () => {
            throw new ForbiddenError('Access denied');
        });

        const res = await app.request('/forbidden');
        expect(res.status).toBe(403);
        const json = (await res.json()) as any;
        expect(json.code).toBe('FORBIDDEN');

        await kernel.shutdown();
    });

    it('should handle generic IskraError as 500', async () => {
        const kernel = await createKernelWithErrorHandler();
        const app = kernel.getApp();

        app.get('/iskra-err', () => {
            throw new DriverError('DB driver failed', {
                code: 'DRIVER_START_FAILED',
                context: { driver: 'postgres' },
            });
        });

        const res = await app.request('/iskra-err');
        expect(res.status).toBe(500);
        const json = (await res.json()) as any;
        expect(json.code).toBe('DRIVER_START_FAILED');

        await kernel.shutdown();
    });

    it('should handle native Hono HTTPException', async () => {
        const kernel = await createKernelWithErrorHandler();
        const app = kernel.getApp();

        app.get('/hono-err', () => {
            throw new HTTPException(418, { message: "I'm a teapot" });
        });

        const res = await app.request('/hono-err');
        expect(res.status).toBe(418);
        const json = (await res.json()) as any;
        expect(json.error).toBe("I'm a teapot");

        await kernel.shutdown();
    });

    it('should handle generic Error as 500', async () => {
        const kernel = await createKernelWithErrorHandler();
        const app = kernel.getApp();

        app.get('/generic', () => {
            throw new Error('Something went wrong');
        });

        const res = await app.request('/generic');
        expect(res.status).toBe(500);
        const json = (await res.json()) as any;
        // Without includeStack, should show generic message
        expect(json.error).toBe('Internal Server Error');

        await kernel.shutdown();
    });

    it('should include stack trace when includeStack is true', async () => {
        const kernel = await createKernelWithErrorHandler(true);
        const app = kernel.getApp();

        app.get('/stack', () => {
            throw new Error('Detailed error');
        });

        const res = await app.request('/stack');
        expect(res.status).toBe(500);
        const json = (await res.json()) as any;
        expect(json.error).toBe('Detailed error');
        expect(json.stack).toBeDefined();

        await kernel.shutdown();
    });

    it('should include requestId in error response when available', async () => {
        const kernel = new Kernel();
        const { RequestIdFeature } = await import('../src/features/request-id');
        kernel.registerFeature(new RequestIdFeature());
        kernel.registerFeature(new ErrorHandlerFeature());
        await kernel.initialize();

        const app = kernel.getApp();
        app.get('/req-id', () => {
            throw new Error('test');
        });

        const res = await app.request('/req-id');
        expect(res.status).toBe(500);
        const json = (await res.json()) as any;
        expect(json.requestId).toBeDefined();

        await kernel.shutdown();
    });

    it('should include context from HttpError', async () => {
        const kernel = await createKernelWithErrorHandler();
        const app = kernel.getApp();

        app.get('/ctx', () => {
            throw new HttpError(422, 'Unprocessable', {
                code: 'VALIDATION_ERROR',
                context: { field: 'email', reason: 'invalid format' },
            });
        });

        const res = await app.request('/ctx');
        expect(res.status).toBe(422);
        const json = (await res.json()) as any;
        expect(json.context.field).toBe('email');

        await kernel.shutdown();
    });

    it('keeps the context of a 5xx HttpError out of the response', async () => {
        const kernel = await createKernelWithErrorHandler();
        const app = kernel.getApp();

        app.get('/down', () => {
            throw new HttpError(503, 'Down', { context: { dsn: 'x' } });
        });

        const res = await app.request('/down');
        expect(res.status).toBe(503);
        const json = (await res.json()) as any;
        expect(json.error).toBe('Down');
        expect(json.context).toBeUndefined();

        await kernel.shutdown();
    });

    it('includes the context of a 5xx HttpError with includeStack', async () => {
        const kernel = await createKernelWithErrorHandler(true);
        const app = kernel.getApp();

        app.get('/down', () => {
            throw new HttpError(503, 'Down', { context: { dsn: 'x' } });
        });

        const json = (await (await app.request('/down')).json()) as any;
        expect(json.context).toEqual({ dsn: 'x' });

        await kernel.shutdown();
    });

    it('logs client errors (4xx) at debug level and server errors at error level', async () => {
        // Regression: every 4xx was logged as an error, so any client could
        // fill the error log (and page whoever watches it) with 404s and 401s.
        const logged: Record<'debug' | 'info' | 'warn' | 'error', string[]> = {
            debug: [],
            info: [],
            warn: [],
            error: [],
        };
        const logger = {
            debug: (m: string) => logged.debug.push(m),
            info: (m: string) => logged.info.push(m),
            warn: (m: string) => logged.warn.push(m),
            error: (m: string) => logged.error.push(m),
        };
        const kernel = new Kernel({ logger });
        kernel.registerFeature(new ErrorHandlerFeature());
        await kernel.initialize();
        const app = kernel.getApp();
        app.get('/missing', () => {
            throw new NotFoundError('No such thing');
        });
        app.get('/denied', () => {
            throw new HTTPException(401, { message: 'Unauthorized' });
        });
        app.get('/broken', () => {
            throw new Error('Database is down');
        });

        expect((await app.request('/missing')).status).toBe(404);
        expect((await app.request('/denied')).status).toBe(401);
        expect(logged.error).toEqual([]);
        expect(logged.debug).toContain('Request failed with 404');
        expect(logged.debug).toContain('Request failed with 401');

        expect((await app.request('/broken')).status).toBe(500);
        expect(logged.error).toEqual(['Unhandled error']);

        await kernel.shutdown();
    });
});
