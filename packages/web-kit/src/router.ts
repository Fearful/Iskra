import type { Context } from 'hono';
import type { App } from '@iskra-bun/core';
import type { ZodSchemaLike } from './features/validation';

/**
 * A WebDriver route. `schema` takes Zod schemas (v3 or v4); the body and query
 * types the handler receives are inferred from them.
 */
export interface RouteOptions<B = unknown, Q = unknown> {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    path: string;
    schema?: {
        body?: ZodSchemaLike<B>;
        query?: ZodSchemaLike<Q>;
        params?: ZodSchemaLike;
    };
    /**
     * Returns a Response, or data sent as JSON. A method, so routes with
     * different body types still fit in one `RouteOptions[]`.
     */
    handler(ctx: WebContext<B, Q>): unknown;
    doc?: {
        summary?: string;
        tags?: string[];
        description?: string;
    };
}

export interface WebContext<B = unknown, Q = unknown> {
    raw: Context;
    body: B;
    query: Q;
    params: Record<string, string>;
    app: App;
}

/**
 * Declares a route with the body and query types inferred from its schema
 * (inside a plain `routes: [...]` list they would be `unknown`):
 *
 * ```ts
 * defineRoute({
 *     method: "POST",
 *     path: "/users",
 *     schema: { body: z.object({ name: z.string() }) },
 *     handler: (ctx) => ({ created: ctx.body.name }), // string
 * });
 * ```
 */
export function defineRoute<B = unknown, Q = unknown>(route: RouteOptions<B, Q>): RouteOptions<B, Q> {
    return route;
}

export const createRouter = (routes: RouteOptions[]) => routes;
