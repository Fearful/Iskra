import type { MiddlewareHandler } from 'hono';
import Ajv from 'ajv';
import addErrors from 'ajv-errors';
import addFormats from 'ajv-formats';
import type { ErrorObject } from 'ajv';
import { ErrorCodes, errorResponse } from '../responses';
import { consoleLogger, type KernelLogger } from '../logging';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface JsonValidationSchema {
    params?: Record<string, unknown>;
    query?: Record<string, unknown>;
    body?: Record<string, unknown>;
}

export interface JsonValidationOptions {
    logErrors?: boolean;
    /** Where errors are logged (default: the console). */
    logger?: KernelLogger;
    status?: number;
    allErrors?: boolean;
    coerceTypes?: boolean;
}

/** What `c.get("validated")` holds after `validateJson()`. */
export interface JsonValidated<Body = unknown, Query = unknown, Params = unknown> {
    params: Params;
    query: Query;
    body: Body;
}

export interface FormattedValidationErrors {
    fields: Record<string, string[]>;
    errors: string[];
}

// ─── Ajv Instance Factory ───────────────────────────────────────────────────

function createAjvInstance(options: JsonValidationOptions = {}): Ajv {
    const ajv = new Ajv({
        allErrors: options.allErrors ?? true,
        coerceTypes: options.coerceTypes ?? true,
        verbose: true,
        $data: true,
    });
    addFormats(ajv);
    addErrors(ajv);
    return ajv;
}

// ─── Error Formatter ────────────────────────────────────────────────────────

/**
 * Most distinct errors reported per request. ajv-errors needs `allErrors`, so a
 * body whose array items each fail yields one error per item.
 */
const MAX_REPORTED_ERRORS = 100;

function formatAjvErrors(errors: ErrorObject[] | null | undefined): FormattedValidationErrors {
    const result: FormattedValidationErrors = { fields: {}, errors: [] };
    if (!errors) return result;

    // Sets, and at most MAX_REPORTED_ERRORS: de-duplicating with
    // Array.includes() was quadratic in the number of errors, so one 117 KiB
    // body of array items blocked the event loop for seconds.
    const reported = new Set<string>();
    const fieldMessages = new Map<string, Set<string>>();

    for (const err of errors) {
        if (reported.size >= MAX_REPORTED_ERRORS) break;
        let fieldPath: string;

        if (err.instancePath) {
            fieldPath = err.instancePath.replace(/^\//, '').replace(/\//g, '.');
        } else if (err.params && 'missingProperty' in err.params) {
            fieldPath = err.params.missingProperty as string;
        } else {
            fieldPath = '_root';
        }

        const message = err.message || 'Invalid value';

        let messages = fieldMessages.get(fieldPath);
        if (!messages) fieldMessages.set(fieldPath, (messages = new Set()));
        messages.add(message);

        const formatted = fieldPath === '_root' ? message : `${fieldPath}: ${message}`;
        if (!reported.has(formatted)) {
            reported.add(formatted);
            result.errors.push(formatted);
        }
    }

    // Defined, not assigned: a field path comes from the request's own keys,
    // and `fields["__proto__"] = [...]` would replace the object's prototype.
    for (const [fieldPath, messages] of fieldMessages) {
        Object.defineProperty(result.fields, fieldPath, {
            value: [...messages],
            enumerable: true,
            writable: true,
            configurable: true,
        });
    }

    return result;
}

// ─── Validation Middleware ───────────────────────────────────────────────────

/**
 * Middleware that validates a request's route params, query and/or body
 * against JSON Schemas (AJV, with ajv-formats and ajv-errors). On failure it
 * answers `status` (400) with the errors by field; on success the handler reads
 * the data from `c.get("validated")`. A JSON Schema does not carry a
 * TypeScript type, so give the validated shapes as type parameters:
 *
 * ```ts
 * app.post("/users", validateJson<{ name: string }>({ body: userSchema }), (c) => {
 *     const { name } = c.get("validated").body;
 * });
 * ```
 */
export function validateJson<Body = unknown, Query = unknown, Params = unknown>(
    schema: JsonValidationSchema,
    options: JsonValidationOptions = {},
): MiddlewareHandler<{ Variables: { validated: JsonValidated<Body, Query, Params> } }> {
    const { logErrors = true, status = 400, logger = consoleLogger } = options;
    const ajv = createAjvInstance(options);

    const validators = {
        params: schema.params ? ajv.compile(schema.params) : null,
        query: schema.query ? ajv.compile(schema.query) : null,
        body: schema.body ? ajv.compile(schema.body) : null,
    };

    return async (c, next) => {
        try {
            const validated: { params?: unknown; query?: unknown; body?: unknown } = {};

            if (validators.params) {
                const data = { ...c.req.param() };
                const valid = validators.params(data);
                if (!valid) {
                    const details = formatAjvErrors(validators.params.errors);
                    return c.json(
                        errorResponse('Invalid route params', ErrorCodes.VALIDATION_ERROR, details),
                        status as ContentfulStatusCode,
                    );
                }
                validated.params = data;
            }

            if (validators.query) {
                const data = { ...c.req.query() };
                const valid = validators.query(data);
                if (!valid) {
                    const details = formatAjvErrors(validators.query.errors);
                    return c.json(
                        errorResponse('Invalid query params', ErrorCodes.VALIDATION_ERROR, details),
                        status as ContentfulStatusCode,
                    );
                }
                validated.query = data;
            }

            if (validators.body) {
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

                const valid = validators.body(data);
                if (!valid) {
                    const details = formatAjvErrors(validators.body.errors);
                    return c.json(
                        errorResponse('Invalid body', ErrorCodes.VALIDATION_ERROR, details),
                        status as ContentfulStatusCode,
                    );
                }
                validated.body = data;
            }

            // What the schemas accepted, as the caller typed it.
            c.set('validated', validated as JsonValidated<Body, Query, Params>);
            await next();
        } catch (err) {
            if (logErrors) logger.error('JSON Schema validation error', err);
            return c.json(errorResponse('Validation middleware failed', ErrorCodes.INTERNAL_ERROR), 500);
        }
    };
}

export { formatAjvErrors };
