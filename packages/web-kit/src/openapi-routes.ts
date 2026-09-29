import { statusText } from './hono';
import type { ResponseContract } from './contract';
import {
    routeDocOf,
    schemaId,
    toJsonSchema,
    type GateSecurity,
    type JsonSchema,
    type RouteDescription,
    type RouteDocFragment,
    type SchemaInput,
    type SecurityScheme,
} from './route-docs';

/** A route as Hono lists it in `app.routes`. */
export interface RouteEntry {
    method: string;
    path: string;
    handler: unknown;
}

export interface RoutesDocumentOptions {
    /**
     * `'described'` (the default): the routes with a `describeRoute()`, on
     * them or on their group. `'all'`: every route with a method OpenAPI
     * knows and a path without wildcards.
     */
    include?: 'described' | 'all';
    /** Where the error and success bodies' schemas come from. */
    contract?: ResponseContract;
    /** Operations already in the spec (`GET /users/{id}`), left as they are. */
    skip?: (method: string, openApiPath: string) => boolean;
}

/** The part of an OpenAPI document the routes make. */
export interface RoutesDocument {
    paths: Record<string, Record<string, unknown>>;
    schemas: Record<string, JsonSchema>;
    securitySchemes: Record<string, SecurityScheme>;
}

const METHODS = new Set(['GET', 'PUT', 'POST', 'DELETE', 'OPTIONS', 'HEAD', 'PATCH', 'TRACE']);

/** The component that holds the contract's error body. */
const ERROR_SCHEMA = 'ErrorResponse';

/** A middleware path as a test of the route paths it covers (`/api/*` covers `/api/users/:id`). */
function covers(pattern: string): (path: string) => boolean {
    if (pattern === '*' || pattern === '/*') return () => true;
    const source = pattern
        .split('*')
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/:[^/]+/g, '[^/]+'))
        .join('.*');
    // Hono's `/api/*` also matches `/api`.
    const regex = new RegExp(`^${source.replace(/\/\.\*$/, '(?:/.*)?')}$`);
    return (path) => regex.test(path);
}

interface PathParam {
    name: string;
    pattern?: string;
}

/**
 * A Hono path as OpenAPI paths: `/users/:id{[0-9]+}` is `/users/{id}`; an
 * optional parameter (`/:page?`) gives the path with it and without.
 */
function openApiPaths(path: string): Array<{ path: string; params: PathParam[] }> {
    let variants: Array<{ segments: string[]; params: PathParam[] }> = [{ segments: [], params: [] }];
    for (const segment of path.split('/').slice(1)) {
        const match = /^:([^{?]+)(?:\{(.+)\})?(\?)?$/.exec(segment);
        if (!match) {
            for (const v of variants) v.segments.push(segment);
            continue;
        }
        const [, name, pattern, optional] = match as unknown as [string, string, string?, string?];
        const param = { name, ...(pattern ? { pattern: `^${pattern}$` } : {}) };
        const withParam = variants.map((v) => ({
            segments: [...v.segments, `{${name}}`],
            params: [...v.params, param],
        }));
        variants = optional ? [...variants, ...withParam] : withParam;
    }
    return variants.map((v) => ({ path: `/${v.segments.join('/')}`, params: v.params }));
}

/** An operation's fragments merged, in the order its handlers run. */
interface Merged {
    described: boolean;
    doc: RouteDescription;
    tags: string[];
    params?: SchemaInput;
    query?: SchemaInput;
    body?: SchemaInput;
    bodyTypes?: string[];
    validates: boolean;
    /** Every `requireActor()` on the route must pass: their alternatives, combined. */
    required?: GateSecurity;
    secured: boolean;
    /** `identify()`'s: a request may come without credentials. */
    optional?: GateSecurity;
    scopes: string[];
}

/** Every combination of one alternative of `a` and one of `b`. */
const both = (a: GateSecurity, b: GateSecurity): GateSecurity => a.flatMap((x) => b.map((y) => [...x, ...y]));

function merge(fragments: readonly RouteDocFragment[]): Merged {
    const merged: Merged = { described: false, doc: {}, tags: [], validates: false, secured: false, scopes: [] };
    for (const fragment of fragments) {
        if (fragment.describe) {
            const { tags, request, responses, ...rest } = fragment.describe;
            merged.described = true;
            merged.doc = {
                ...merged.doc,
                ...rest,
                ...(responses ? { responses: { ...merged.doc.responses, ...responses } } : {}),
            };
            for (const tag of tags ?? []) if (!merged.tags.includes(tag)) merged.tags.push(tag);
            if (request?.params) merged.params = request.params;
            if (request?.query) merged.query = request.query;
            if (request?.body) merged.body = request.body;
            if (request?.bodyTypes) merged.bodyTypes = request.bodyTypes;
            if (request?.headers) merged.doc.request = { ...merged.doc.request, headers: request.headers };
        }
        if (fragment.validates) {
            const { params, query, body, bodyTypes } = fragment.validates;
            merged.validates = true;
            if (params) merged.params = params;
            if (query) merged.query = query;
            if (body) {
                merged.body = body;
                merged.bodyTypes = bodyTypes;
            }
        }
        if (fragment.gate) {
            const security = fragment.gate.security ?? [];
            if (fragment.gate.optional) merged.optional = [...(merged.optional ?? []), ...security];
            else {
                merged.secured = true;
                merged.required = merged.required ? both(merged.required, security) : security;
            }
        }
        for (const scope of fragment.scopes ?? []) if (!merged.scopes.includes(scope)) merged.scopes.push(scope);
    }
    return merged;
}

/** Builds the operations, collecting their schemas and security schemes. */
class Builder {
    readonly doc: RoutesDocument = { paths: {}, schemas: {}, securitySchemes: {} };

    constructor(private readonly contract: ResponseContract | undefined) {}

    /**
     * `input` as JSON Schema; the Zod schemas named with `.meta({ id })`, in
     * it or itself, go to the components and are referenced.
     */
    schema(input: SchemaInput | undefined, io: 'input' | 'output'): JsonSchema {
        const converted = toJsonSchema(input, io);
        const { $defs, ...schema } = converted as JsonSchema & { $defs?: Record<string, JsonSchema> };
        for (const [name, def] of Object.entries($defs ?? {})) this.doc.schemas[name] ??= this.refs(def);
        const id = schemaId(input);
        if (id === undefined) return this.refs(schema);
        this.doc.schemas[id] ??= this.refs(schema);
        return { $ref: `#/components/schemas/${id}` };
    }

    /** `#/$defs/X` as `#/components/schemas/X`. */
    private refs<T>(value: T): T {
        if (Array.isArray(value)) return value.map((v) => this.refs(v)) as T;
        if (typeof value !== 'object' || value === null) return value;
        return Object.fromEntries(
            Object.entries(value).map(([key, v]) => [
                key,
                key === '$ref' && typeof v === 'string'
                    ? v.replace(/^#\/\$defs\//, '#/components/schemas/')
                    : this.refs(v),
            ]),
        ) as T;
    }

    /** One parameter per property of an object schema. */
    parameters(input: SchemaInput | undefined, where: 'query' | 'header'): unknown[] {
        if (!input) return [];
        const schema = this.schema(input, 'input');
        const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
        const required = new Set((schema.required ?? []) as string[]);
        return Object.entries(properties).map(([name, property]) => {
            const { description, ...rest } = property;
            return {
                name,
                in: where,
                ...(required.has(name) ? { required: true } : {}),
                ...(typeof description === 'string' ? { description } : {}),
                schema: rest,
            };
        });
    }

    private errorResponse(description: string): Record<string, unknown> {
        const schemas = this.contract?.schemas;
        if (!schemas?.error) return { description };
        this.doc.schemas[ERROR_SCHEMA] ??= schemas.error;
        return {
            description,
            content: {
                [schemas.errorType ?? 'application/json']: { schema: { $ref: `#/components/schemas/${ERROR_SCHEMA}` } },
            },
        };
    }

    private responses(merged: Merged): Record<string, unknown> {
        const { doc } = merged;
        const schemas = this.contract?.schemas;
        const out: Record<string, unknown> = {};
        const body = (schema: JsonSchema, type = 'application/json') => ({ content: { [type]: { schema } } });

        if (doc.ok) {
            const data = this.schema(doc.ok, 'output');
            out['200'] = { description: 'OK', ...body(schemas?.success ? schemas.success(data) : data) };
        }
        if (doc.list) {
            const item = this.schema(doc.list, 'output');
            out['200'] = {
                description: 'OK',
                ...body(schemas?.list ? schemas.list(item) : { type: 'array', items: item }),
            };
        }
        for (const [status, response] of Object.entries(doc.responses ?? {})) {
            const headers = Object.entries(response.headers ?? {}).map(([name, header]) => [
                name,
                {
                    ...(header.description ? { description: header.description } : {}),
                    schema: header.schema ? this.schema(header.schema, 'output') : { type: 'string' },
                },
            ]);
            out[status] = {
                description: response.description ?? (statusText(Number(status)) || 'Response'),
                ...(headers.length > 0 ? { headers: Object.fromEntries(headers) } : {}),
                ...(response.schema ? body(this.schema(response.schema, 'output'), response.contentType) : {}),
            };
        }
        if (Object.keys(out).length === 0) out['200'] = { description: 'OK' };

        if (merged.validates && !out['400']) out['400'] = this.errorResponse('Invalid request');
        if (merged.secured && !out['401']) out['401'] = this.errorResponse('No valid credentials');
        if (merged.scopes.length > 0 && !out['403']) out['403'] = this.errorResponse('Missing scopes');
        if (!out.default && schemas?.error) out.default = this.errorResponse('Error');
        return out;
    }

    private security(merged: Merged): Array<Record<string, string[]>> | undefined {
        if (merged.doc.security) return merged.doc.security;
        const alternatives = [...(merged.required ?? []), ...(merged.secured ? [] : (merged.optional ?? []))];
        if (alternatives.length === 0) return undefined;
        const requirements = alternatives.map((schemes) => {
            for (const { name, scheme } of schemes) this.doc.securitySchemes[name] ??= scheme;
            return Object.fromEntries(schemes.map(({ name }) => [name, merged.scopes]));
        });
        // identify(): a request without credentials is let through.
        return merged.secured ? requirements : [...requirements, {}];
    }

    add(method: string, path: string, merged: Merged, skip: RoutesDocumentOptions['skip']): void {
        const { doc } = merged;
        for (const variant of openApiPaths(path)) {
            if (skip?.(method, variant.path)) continue;
            const paramSchema = merged.params ? this.schema(merged.params, 'input') : {};
            const properties = (paramSchema.properties ?? {}) as Record<string, JsonSchema>;
            const pathParams = variant.params.map(({ name, pattern }) => {
                const { description, ...schema } = properties[name] ?? {
                    type: 'string',
                    ...(pattern ? { pattern } : {}),
                };
                return {
                    name,
                    in: 'path',
                    required: true,
                    ...(typeof description === 'string' ? { description } : {}),
                    schema,
                };
            });
            const parameters = [
                ...pathParams,
                ...this.parameters(merged.query, 'query'),
                ...this.parameters(doc.request?.headers, 'header'),
            ];
            const bodySchema = merged.body ? this.schema(merged.body, 'input') : undefined;
            const security = this.security(merged);
            const operation = {
                ...(merged.tags.length > 0 ? { tags: merged.tags } : {}),
                ...(doc.summary ? { summary: doc.summary } : {}),
                ...(doc.description ? { description: doc.description } : {}),
                ...(doc.operationId ? { operationId: doc.operationId } : {}),
                ...(doc.deprecated ? { deprecated: true } : {}),
                ...(parameters.length > 0 ? { parameters } : {}),
                ...(bodySchema
                    ? {
                          requestBody: {
                              required: true,
                              content: Object.fromEntries(
                                  (merged.bodyTypes ?? ['application/json']).map((type) => [
                                      type,
                                      { schema: bodySchema },
                                  ]),
                              ),
                          },
                      }
                    : {}),
                responses: this.responses(merged),
                ...(security ? { security } : {}),
            };
            (this.doc.paths[variant.path] ??= {})[method.toLowerCase()] = operation;
        }
    }
}

/**
 * The OpenAPI paths of a Hono app's routes (`app.routes`), read from what
 * their handlers carry: `describeRoute()`, `validate()`, `validateJson()`,
 * `requireActor()`, `identify()` and `requireScopes()`, on the route, on its
 * group, or on an `app.use()` path registered before it.
 */
export function documentRoutes(routes: readonly RouteEntry[], options: RoutesDocumentOptions = {}): RoutesDocument {
    const include = options.include ?? 'described';
    const builder = new Builder(options.contract);
    /** Per operation: the index of its last handler, and its path. */
    const operations = new Map<string, { method: string; path: string; last: number }>();
    routes.forEach((route, index) => {
        const method = route.method.toUpperCase();
        if (!METHODS.has(method) || route.path.includes('*')) return;
        const key = `${method} ${route.path}`;
        const found = operations.get(key);
        if (found) found.last = index;
        else operations.set(key, { method, path: route.path, last: index });
    });

    const matchers = routes.map((route) => covers(route.path));
    for (const { method, path, last } of operations.values()) {
        const fragments: RouteDocFragment[] = [];
        for (let i = 0; i <= last; i++) {
            const route = routes[i]!;
            const routeMethod = route.method.toUpperCase();
            if (routeMethod !== 'ALL' && routeMethod !== method) continue;
            // Another path counts as middleware (`app.use()`, a wildcard), not
            // as the handler of a route that happens to match this path.
            const middleware = routeMethod === 'ALL' || route.path.includes('*');
            if (route.path !== path && !(middleware && matchers[i]!(path))) continue;
            const fragment = routeDocOf(route.handler);
            if (fragment) fragments.push(fragment);
        }
        const merged = merge(fragments);
        if (merged.doc.hidden || (include === 'described' && !merged.described)) continue;
        builder.add(method, path, merged, options.skip);
    }
    return builder.doc;
}
