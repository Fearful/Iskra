import type { MiddlewareHandler } from 'hono';
import { ErrorCodes, errorResponse } from '../responses';
import { consoleLogger, type KernelLogger } from '../logging';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/**
 * A Zod schema, v3 or v4 (web-kit's `z` is v3, the one re-exported for
 * OpenAPI is v4): anything with Zod's `safeParse()`.
 */
export interface ZodSchemaLike<T = unknown> {
    safeParse(data: unknown): { success: true; data: T } | { success: false; error: { flatten(): unknown } };
}

/** Zod schemas for the parts of a request to validate. */
export interface ValidationSchema {
    params?: ZodSchemaLike;
    query?: ZodSchemaLike;
    body?: ZodSchemaLike;
}

type Parsed<S> = S extends ZodSchemaLike<infer T> ? T : undefined;

/** What `c.get("validated")` holds after `validate(schema)`: each part as its schema parses it. */
export interface Validated<S extends ValidationSchema> {
    params: Parsed<S['params']>;
    query: Parsed<S['query']>;
    body: Parsed<S['body']>;
}

export interface ValidationOptions {
    logErrors?: boolean;
    /** Where errors are logged (default: the console). */
    logger?: KernelLogger;
    status?: number;
}

/**
 * Middleware that validates a request's route params, query and/or body with
 * Zod. On failure it answers `status` (400) with the flattened errors; on
 * success the handler reads the parsed data, typed, from `c.get("validated")`:
 *
 * ```ts
 * app.post("/users", validate({ body: z.object({ name: z.string() }) }), (c) => {
 *     const { name } = c.get("validated").body; // string
 * });
 * ```
 */
export function validate<S extends ValidationSchema>(
    schema: S,
    options: ValidationOptions = {},
): MiddlewareHandler<{ Variables: { validated: Validated<S> } }> {
    const { logErrors = true, status = 400, logger = consoleLogger } = options;

    return async (c, next) => {
        try {
            const validated: { params?: unknown; query?: unknown; body?: unknown } = {};

            if (schema.params) {
                const parsed = schema.params.safeParse(c.req.param());
                if (!parsed.success) {
                    return c.json(
                        errorResponse('Invalid route params', ErrorCodes.VALIDATION_ERROR, parsed.error.flatten()),
                        status as ContentfulStatusCode,
                    );
                }
                validated.params = parsed.data;
            }

            if (schema.query) {
                const parsed = schema.query.safeParse(c.req.query());
                if (!parsed.success) {
                    return c.json(
                        errorResponse('Invalid query params', ErrorCodes.VALIDATION_ERROR, parsed.error.flatten()),
                        status as ContentfulStatusCode,
                    );
                }
                validated.query = parsed.data;
            }

            if (schema.body) {
                let data: unknown = {};
                const contentType = c.req.header('content-type') || '';
                if (contentType.includes('application/json')) {
                    data = await c.req.json().catch(() => ({}));
                } else if (
                    contentType.includes('application/x-www-form-urlencoded') ||
                    contentType.includes('multipart/form-data')
                ) {
                    data = await c.req.parseBody();
                }

                const parsed = schema.body.safeParse(data);
                if (!parsed.success) {
                    return c.json(
                        errorResponse('Invalid body', ErrorCodes.VALIDATION_ERROR, parsed.error.flatten()),
                        status as ContentfulStatusCode,
                    );
                }
                validated.body = parsed.data;
            }

            // Each part present was parsed by its schema; the others are undefined.
            c.set('validated', validated as Validated<S>);
            await next();
        } catch (err) {
            if (logErrors) logger.error('Validation error', err);
            return c.json(errorResponse('Validation middleware failed', ErrorCodes.INTERNAL_ERROR), 500);
        }
    };
}
