import type { Context } from 'hono';
import { ErrorCodes } from '@iskra-bun/core';
import { HttpError, ValidationError } from './errors';
import { responderOf } from './contract';
import type { ZodSchemaLike } from './features/validation';

/** A failed field, for a custom `details` format. */
export interface ValidationIssue {
    /** Where, as `address.city` (`''` for the whole value). */
    path: string;
    message: string;
    code?: string;
}

/**
 * How a failed validation's `details` look: `'flatten'` (Zod's
 * `{ formErrors, fieldErrors }`, the default), `'issues'` (`[{ path, message,
 * code }]`), `'fields'` (`{ "address.city": ["Required"] }`) or a function.
 */
export type ValidationDetails = 'flatten' | 'issues' | 'fields' | ((issues: ValidationIssue[]) => unknown);

export interface BindOptions {
    /**
     * Match the request's keys to the schema's ignoring case, as Go's
     * encoding/json does: `{ "NOMBRE": "Ana" }` fills `nombre`. Nested objects
     * and arrays too. Needs a Zod object schema (it reads its shape).
     */
    caseInsensitiveKeys?: boolean;
    /** Also accept form bodies (urlencoded and multipart). Default: JSON only. */
    allowForm?: boolean;
    /** The `details` of a failed validation; default: the contract's, else `'flatten'`. */
    details?: ValidationDetails;
}

type SchemaNode = {
    shape?: Record<string, unknown>;
    element?: unknown;
    unwrap?: () => unknown;
    _def?: { innerType?: unknown; schema?: unknown };
    def?: { innerType?: unknown; in?: unknown };
};

/** The object or array schema inside optional, nullable, default and effects wrappers (Zod 3 and 4). */
function unwrap(schema: unknown): SchemaNode | undefined {
    let node = schema as SchemaNode | undefined;
    for (let depth = 0; node && depth < 10; depth++) {
        if (node.shape || node.element) return node;
        const next =
            typeof node.unwrap === 'function'
                ? node.unwrap()
                : (node._def?.innerType ?? node._def?.schema ?? node.def?.innerType ?? node.def?.in);
        if (!next || next === node) return node;
        node = next as SchemaNode;
    }
    return node;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof File);

/** The schema's key for `key`: itself, or the one equal ignoring case. */
function keyIn(shape: Record<string, unknown>, key: string, byLower: Map<string, string>): string {
    return Object.hasOwn(shape, key) ? key : (byLower.get(key.toLowerCase()) ?? key);
}

/** `data` with its keys renamed to the schema's where they match ignoring case (a later key wins, as in Go). */
export function matchKeys(data: unknown, schema: unknown): unknown {
    const node = unwrap(schema);
    if (Array.isArray(data)) return node?.element ? data.map((item) => matchKeys(item, node.element)) : data;
    if (!isRecord(data) || !node?.shape) return data;
    const shape = node.shape;
    const byLower = new Map(Object.keys(shape).map((key) => [key.toLowerCase(), key]));
    const matched: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
        const target = keyIn(shape, key, byLower);
        matched[target] = matchKeys(value, shape[target]);
    }
    return matched;
}

/** A failed Zod parse's issues, flat (Zod 3 and 4 both have `issues`). */
function issuesOf(error: unknown): ValidationIssue[] {
    const issues = (error as { issues?: { path?: PropertyKey[]; message: string; code?: string }[] }).issues ?? [];
    return issues.map((issue) => ({
        path: (issue.path ?? []).map(String).join('.'),
        message: issue.message,
        ...(issue.code ? { code: issue.code } : {}),
    }));
}

/** A failed validation's details in the chosen format. */
export function validationDetails(c: Context, error: { flatten(): unknown }, format?: ValidationDetails): unknown {
    const chosen = format ?? responderOf(c).contract.validationDetails ?? 'flatten';
    if (chosen === 'flatten') return error.flatten();
    const issues = issuesOf(error);
    if (chosen === 'issues') return issues;
    if (chosen === 'fields') {
        const fields: Record<string, string[]> = {};
        for (const { path, message } of issues) (fields[path] ??= []).push(message);
        return fields;
    }
    return chosen(issues);
}

const FORM_TYPES = new Set(['application/x-www-form-urlencoded', 'multipart/form-data']);

/**
 * The request's body: JSON (`application/json` or `+json`), or a form with
 * `allowForm`. An empty body is `{}`; malformed JSON is a 400 and another
 * content type a 415 (`HttpError`s, answered by the response contract).
 */
export async function readBody(c: Context, options: { allowForm?: boolean } = {}): Promise<unknown> {
    if (c.req.header('content-length') === '0') return {};
    const type = (c.req.header('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (type === 'application/json' || type.endsWith('+json')) {
        const text = await c.req.text();
        if (text.trim() === '') return {};
        try {
            return JSON.parse(text);
        } catch {
            throw new HttpError(400, 'Malformed JSON body', { code: ErrorCodes.BAD_REQUEST });
        }
    }
    if (options.allowForm && FORM_TYPES.has(type)) return c.req.parseBody({ all: true });
    // Nothing sent: an empty body binds nothing, as in Echo.
    if (!type && (await c.req.text()) === '') return {};
    throw new HttpError(415, type ? `Unsupported content type: ${type}` : 'Missing content type', {
        code: ErrorCodes.UNSUPPORTED_MEDIA_TYPE,
    });
}

/**
 * The request's body parsed by `schema`, typed; throws a `ValidationError`
 * (400, with the failed fields in `details`) when it does not match. JSON by
 * default; see `BindOptions` for forms and case-insensitive keys.
 *
 * ```ts
 * app.post('/users', async (c) => {
 *     const user = await bindBody(c, z.object({ nombre: z.string() }), { caseInsensitiveKeys: true });
 *     return ok(c, await users.create(user), { status: 201 });
 * });
 * ```
 */
export async function bindBody<T>(c: Context, schema: ZodSchemaLike<T>, options: BindOptions = {}): Promise<T> {
    const body = await readBody(c, options);
    const parsed = schema.safeParse(options.caseInsensitiveKeys ? matchKeys(body, schema) : body);
    if (!parsed.success) throw new ValidationError('Invalid body', validationDetails(c, parsed.error, options.details));
    return parsed.data;
}

/**
 * Every query parameter: a string, or an array of strings for one that
 * appears more than once (`?id=1&id=2` → `{ id: ['1', '2'] }`).
 */
export function queryParams(c: Context): Record<string, string | string[]> {
    return Object.fromEntries(
        Object.entries(c.req.queries()).map(([key, values]) => [key, values.length === 1 ? values[0]! : values]),
    );
}

/** The query as an object for `schema`: every value for its array fields, the first one for the rest. */
export function queryFor(c: Context, schema: unknown, caseInsensitiveKeys = false): Record<string, unknown> {
    const shape = unwrap(schema)?.shape ?? {};
    const byLower = new Map(Object.keys(shape).map((key) => [key.toLowerCase(), key]));
    const query: Record<string, unknown> = {};
    const exact = new Set<string>();
    for (const [key, values] of Object.entries(c.req.queries())) {
        const target = caseInsensitiveKeys ? keyIn(shape, key, byLower) : key;
        // A parameter named exactly as the field wins over one that only matches ignoring case.
        if (target !== key && exact.has(target)) continue;
        if (target === key) exact.add(key);
        query[target] = unwrap(shape[target])?.element ? values : values[0];
    }
    return query;
}

/**
 * The query parameters parsed by `schema`, typed: a field declared as an
 * array takes every value of a repeated parameter (`?id=1&id=2`), the others
 * the first. Throws a `ValidationError` (400) when they do not match; use
 * `z.coerce` for numbers and dates.
 */
export function bindQuery<T>(c: Context, schema: ZodSchemaLike<T>, options: Omit<BindOptions, 'allowForm'> = {}): T {
    const parsed = schema.safeParse(queryFor(c, schema, options.caseInsensitiveKeys));
    if (!parsed.success) {
        throw new ValidationError('Invalid query params', validationDetails(c, parsed.error, options.details));
    }
    return parsed.data;
}
