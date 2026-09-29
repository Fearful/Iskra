import type { MiddlewareHandler } from 'hono';
import { ErrorCodes } from '../responses';
import { problem, responderOf } from '../contract';
import { consoleLogger, type KernelLogger } from '../logging';
import { matchKeys, queryFor, readBody, validationDetails, type ValidationDetails } from '../bind';
import { HttpError } from '../errors';

/**
 * A Zod schema, v3 or v4 (web-kit's `z` is v3, the one re-exported for
 * OpenAPI is v4): anything with Zod's `safeParse()`.
 */
export interface ZodSchemaLike<T = unknown> {
    safeParse(
        data: unknown,
    ): { success: true; data: T } | { success: false; error: { flatten(): unknown; issues?: readonly unknown[] } };
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
    /**
     * Match body and query keys to the schema's ignoring case (`NOMBRE` fills
     * `nombre`), as Go's encoding/json does. Needs Zod object schemas.
     */
    caseInsensitiveKeys?: boolean;
    /** Accept form bodies (urlencoded, multipart) besides JSON. Default true. */
    allowForm?: boolean;
    /** The `details` of a failure; default: the response contract's, else Zod's `flatten()`. */
    details?: ValidationDetails;
}

/**
 * Middleware that validates a request's route params, query and/or body with
 * Zod. On failure it answers `status` (400) with the failed fields in
 * `details`, by the response contract; malformed JSON is a 400 and a body
 * that is neither JSON nor a form a 415. On success the handler reads the
 * parsed data, typed, from `c.get("validated")`:
 *
 * ```ts
 * app.post("/users", validate({ body: z.object({ name: z.string() }) }), (c) => {
 *     const { name } = c.get("validated").body; // string
 * });
 * ```
 *
 * A query field declared as an array takes every value of a repeated
 * parameter (`?id=1&id=2`); the others take the first.
 */
export function validate<S extends ValidationSchema>(
    schema: S,
    options: ValidationOptions = {},
): MiddlewareHandler<{ Variables: { validated: Validated<S> } }> {
    const { logErrors = true, status = 400, logger = consoleLogger, caseInsensitiveKeys = false } = options;

    return async (c, next) => {
        /** The part parsed by its schema, or the problem response for it. */
        const check = (part: ZodSchemaLike, data: unknown, message: string) => {
            const parsed = part.safeParse(caseInsensitiveKeys ? matchKeys(data, part) : data);
            if (parsed.success) return { data: parsed.data };
            const details = validationDetails(c, parsed.error, options.details);
            return {
                response: responderOf(c).problem(
                    c,
                    problem(status, { code: ErrorCodes.VALIDATION_ERROR, message, details }),
                ),
            };
        };
        try {
            const validated: { params?: unknown; query?: unknown; body?: unknown } = {};

            if (schema.params) {
                const result = check(schema.params, c.req.param(), 'Invalid route params');
                if (result.response) return result.response;
                validated.params = result.data;
            }

            if (schema.query) {
                const result = check(
                    schema.query,
                    queryFor(c, schema.query, caseInsensitiveKeys),
                    'Invalid query params',
                );
                if (result.response) return result.response;
                validated.query = result.data;
            }

            if (schema.body) {
                const body = await readBody(c, { allowForm: options.allowForm ?? true });
                const result = check(schema.body, body, 'Invalid body');
                if (result.response) return result.response;
                validated.body = result.data;
            }

            // Each part present was parsed by its schema; the others are undefined.
            c.set('validated', validated as Validated<S>);
            await next();
        } catch (err) {
            // Malformed JSON (400) or an unsupported content type (415).
            if (err instanceof HttpError) return responderOf(c).error(err, c);
            if (logErrors) logger.error('Validation error', err);
            return responderOf(c).problem(c, problem(500, { message: 'Validation middleware failed' }), err);
        }
    };
}
