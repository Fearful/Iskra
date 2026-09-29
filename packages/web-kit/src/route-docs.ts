import type { MiddlewareHandler } from 'hono';
import { toJSONSchema as zod4ToJsonSchema } from 'zod/v4/core';
import { zodToJsonSchema } from 'zod-to-json-schema';

/** A JSON Schema (draft 2020-12, as OpenAPI 3.1 holds it). */
export type JsonSchema = Record<string, unknown>;

/**
 * A schema to document: Zod (v3 or v4), any Standard Schema library that
 * exports JSON Schema (Valibot, ArkType…), or a JSON Schema object.
 */
export type SchemaInput = object;

/** An OpenAPI security scheme, as in the spec's `components.securitySchemes`. */
export interface SecurityScheme {
    type: 'http' | 'apiKey' | 'oauth2' | 'openIdConnect' | 'mutualTLS';
    scheme?: string;
    bearerFormat?: string;
    in?: 'header' | 'query' | 'cookie';
    name?: string;
    description?: string;
    openIdConnectUrl?: string;
    flows?: Record<string, unknown>;
}

/** A gate's scheme, with the name it has in the spec. */
export interface NamedScheme {
    name: string;
    scheme: SecurityScheme;
}

/**
 * What a gate asks for, as the spec states it: alternatives (any one
 * suffices), each the schemes a request presents together.
 */
export type GateSecurity = ReadonlyArray<ReadonlyArray<NamedScheme>>;

/** A response of `describeRoute()`. */
export interface ResponseDoc {
    /** Default: the status text (`Created`). */
    description?: string;
    /** The body. */
    schema?: SchemaInput;
    /** The body's media type. Default `application/json`. */
    contentType?: string;
    headers?: Record<string, { description?: string; schema?: SchemaInput }>;
}

/** How a route appears in `/openapi.json`. See `describeRoute()`. */
export interface RouteDescription {
    summary?: string;
    description?: string;
    /** Added to the tags of the groups the route is in. */
    tags?: string[];
    operationId?: string;
    deprecated?: boolean;
    /** Leave the route out of the spec (with `routes: 'all'`, or a route of a described group). */
    hidden?: boolean;
    /** What the request carries, besides what the route's `validate()` declares. */
    request?: {
        params?: SchemaInput;
        query?: SchemaInput;
        headers?: SchemaInput;
        body?: SchemaInput;
        /** The body's media types. Default `['application/json']`. */
        bodyTypes?: string[];
    };
    /** The 200 of `ok(c, data)`: the schema of `data`, wrapped as the response contract answers. */
    ok?: SchemaInput;
    /** The 200 of `list(c, page)`: the schema of one item, wrapped as the response contract answers. */
    list?: SchemaInput;
    /** Responses by status (`201`, `'default'`). */
    responses?: Record<number | string, ResponseDoc>;
    /**
     * The route's security requirements, instead of what its gates declare
     * (`[{ bearer: [] }]`); `[]` for a public route under a global `security`.
     */
    security?: Array<Record<string, string[]>>;
}

/** What a handler tells the spec about the routes it is on. */
export interface RouteDocFragment {
    /** From `describeRoute()`: the route is described. */
    describe?: RouteDescription;
    /** From a validation middleware: its schemas, and a 400. */
    validates?: {
        params?: SchemaInput;
        query?: SchemaInput;
        body?: SchemaInput;
        bodyTypes?: string[];
    };
    /** From `requireActor()` (`optional: false`) or `identify()` (`optional: true`). */
    gate?: { security?: GateSecurity; optional: boolean };
    /** From `requireScopes()`. */
    scopes?: string[];
}

/** The media types a validation middleware reads a body from. */
export const bodyTypes = (allowForm: boolean): string[] =>
    allowForm ? ['application/json', 'application/x-www-form-urlencoded', 'multipart/form-data'] : ['application/json'];

/** Shared by every copy of web-kit, so each one reads the others' handlers. */
const ROUTE_DOC = Symbol.for('iskra.web-kit.route-doc');

/** `fn` carrying `fragment` for the OpenAPI document. */
export function withRouteDoc<F extends object>(fn: F, fragment: RouteDocFragment): F {
    Object.defineProperty(fn, ROUTE_DOC, { value: fragment, enumerable: false, configurable: true });
    return fn;
}

/** The fragment a handler carries, also through the wrapper Hono puts around a sub-app's handlers. */
export function routeDocOf(handler: unknown): RouteDocFragment | undefined {
    if (typeof handler !== 'function') return undefined;
    const own = (handler as unknown as Record<symbol, RouteDocFragment | undefined>)[ROUTE_DOC];
    if (own) return own;
    const inner = (handler as unknown as Record<string, unknown>).__COMPOSED_HANDLER;
    return inner && inner !== handler ? routeDocOf(inner) : undefined;
}

/**
 * Middleware that documents the routes it is on in OpenAPIFeature's
 * `/openapi.json`; at runtime it only calls `next()`. On a route it
 * describes that route; on a group (or an `app.use()` path) every route
 * under it, whose own `describeRoute()` adds tags and overrides the rest.
 *
 * ```ts
 * const users = api.group('/users', describeRoute({ tags: ['Users'] }), requireActor(auth));
 * users.get('/:id', describeRoute({ summary: 'A user', ok: User }), getUser);
 * users.post('/', describeRoute({ summary: 'Create a user', responses: { 201: { schema: User } } }), validate({ body: NewUser }), createUser);
 * ```
 *
 * `validate()` declares the route's params, query and body, the gates of
 * `requireActor()` its security (and a 401), `requireScopes()` a 403.
 */
export function describeRoute(description: RouteDescription): MiddlewareHandler {
    return withRouteDoc<MiddlewareHandler>(
        async (_c, next) => {
            await next();
        },
        { describe: description },
    );
}

type Io = 'input' | 'output';

/** The id of a Zod v4 schema named with `.meta({ id })`, which the spec lists in its components. */
export function schemaId(schema: SchemaInput | undefined): string | undefined {
    const s = schema as { _zod?: unknown; meta?: () => unknown } | undefined;
    if (!s?._zod || typeof s.meta !== 'function') return undefined;
    try {
        const id = (s.meta() as { id?: unknown } | undefined)?.id;
        return typeof id === 'string' ? id : undefined;
    } catch {
        return undefined;
    }
}

/** `schema` without `$schema`: the document's dialect applies. */
function clean(schema: unknown): JsonSchema {
    if (typeof schema !== 'object' || schema === null) return {};
    const rest = { ...(schema as JsonSchema) };
    delete rest.$schema;
    return rest;
}

/**
 * The JSON Schema of a Zod schema (v3 or v4), of a Standard Schema one
 * that exports JSON Schema, or a JSON Schema as it is. What cannot be
 * represented (a date, a transform's output) becomes `{}` (any value).
 */
export function toJsonSchema(schema: SchemaInput | undefined, io: Io = 'input'): JsonSchema {
    if (schema === null || (typeof schema !== 'object' && typeof schema !== 'function')) return {};
    const s = schema as Record<string, unknown> & { '~standard'?: Record<string, unknown> };
    try {
        const standard = s['~standard'];
        const exported = standard?.jsonSchema as Record<Io, (options: object) => unknown> | undefined;
        if (typeof exported?.[io] === 'function') {
            return clean(exported[io]({ target: 'draft-2020-12', libraryOptions: { unrepresentable: 'any' } }));
        }
        // Zod v4 before 4.2 (and zod@3.25's `zod/v4`).
        if (s._zod) {
            return clean(
                zod4ToJsonSchema(s as never, { io, unrepresentable: 'any', target: 'draft-2020-12' } as never),
            );
        }
        // Zod v3.
        if (s._def && typeof s.safeParse === 'function') {
            return clean(
                zodToJsonSchema(s as never, {
                    $refStrategy: 'none',
                    target: 'jsonSchema2019-09',
                    // An object that strips unknown keys accepts them.
                    removeAdditionalStrategy: 'strict',
                    effectStrategy: io === 'input' ? 'input' : 'any',
                    pipeStrategy: io,
                }),
            );
        }
        // A validator without JSON Schema: any value.
        if (standard) return {};
        return structuredClone(s) as JsonSchema;
    } catch {
        return {};
    }
}
